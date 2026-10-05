// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TimelockController
 * @notice Minimal timelock for Lodestar admin actions.  Every privileged
 *         call on the StakingVault / OracleAggregator flows through this
 *         contract so that parameters cannot be changed instantly — they are
 *         queued publicly, then executable only after `DELAY` seconds (and
 *         before the execution window expires).
 *
 *  Roles:
 *    - scheduler: schedule, cancel, grant/revoke roles, and change the delay
 *      (self-governed — only this contract can call `updateDelay`).
 *    - executor: call execute() once `isReady(id)`.
 *
 *  Roles are tracked per (role, account) pair, so granting SCHEDULER_ROLE
 *  never implicitly grants EXECUTOR_ROLE.
 *
 *  Operation id is deterministic: keccak256(nonce, target, data). The
 *  deploy tooling captures the id from the OperationScheduled event and calls
 *  execute(id) after the delay.
 *
 *  Known scope limits (see docs/known-limitations.md): single-call operations
 *  only — no batching, no per-operation value.
 */
contract TimelockController {
    struct Operation {
        address target;
        bytes   data;
        uint256 eta;
        bool    executed;
        bool    cancelled;
    }

    bytes32 public constant SCHEDULER_ROLE = keccak256("SCHEDULER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");

    uint256 public nonce;
    mapping(bytes32 => mapping(address => bool)) public hasRole;
    mapping(bytes32 => Operation) public operations;
    mapping(bytes32 => uint256) public scheduledAt;

    uint256 public DELAY;
    uint256 public immutable EXECUTION_WINDOW;

    event RoleGranted(bytes32 indexed role, address indexed account);
    event RoleRevoked(bytes32 indexed role, address indexed account);
    event OperationScheduled(bytes32 indexed id, address target, uint256 eta);
    event OperationExecuted(bytes32 indexed id);
    event OperationCancelled(bytes32 indexed id);
    event DelayUpdated(uint256 oldDelay, uint256 newDelay);

    modifier onlyScheduler() {
        require(hasRole[SCHEDULER_ROLE][msg.sender], "TL: not scheduler");
        _;
    }

    modifier onlyExecutor() {
        require(hasRole[EXECUTOR_ROLE][msg.sender], "TL: not executor");
        _;
    }

    constructor(uint256 _delay, uint256 _executionWindow) {
        require(_delay > 0, "TL: zero delay");
        require(_executionWindow > 0, "TL: zero window");
        DELAY = _delay;
        EXECUTION_WINDOW = _executionWindow;
        // deployer starts as scheduler + executor + admin; hand the roles to a
        // multisig right after deploy (see scripts/deploy.ts).
        _grant(SCHEDULER_ROLE, msg.sender);
        _grant(EXECUTOR_ROLE, msg.sender);
        _grant(TIMELOCK_ADMIN_ROLE, msg.sender);
    }

    function schedule(
        address target,
        bytes calldata data
    ) external onlyScheduler returns (bytes32 id) {
        require(target != address(0), "TL: zero target");
        id = _operationId(target, data);
        Operation storage op = operations[id];
        require(op.target == address(0), "TL: already scheduled");

        uint256 eta = block.timestamp + DELAY;
        operations[id] = Operation({
            target: target,
            data: data,
            eta: eta,
            executed: false,
            cancelled: false
        });
        scheduledAt[id] = eta;
        emit OperationScheduled(id, target, eta);
    }

    /**
     * @notice Execute a scheduled operation.  Anyone holding EXECUTOR_ROLE may
     *         call once the delay has passed and the window is open.
     */
    function execute(bytes32 id) external onlyExecutor returns (bytes memory) {
        Operation storage op = operations[id];
        require(op.target != address(0), "TL: not scheduled");
        require(!op.executed, "TL: already executed");
        require(!op.cancelled, "TL: cancelled");
        require(block.timestamp >= op.eta, "TL: delay not passed");
        require(block.timestamp <= op.eta + EXECUTION_WINDOW, "TL: expired");

        op.executed = true;

        (bool success, bytes memory result) = op.target.call(op.data);
        if (!success) {
            if (result.length > 0) {
                assembly { revert(add(result, 32), mload(result)) }
            } else {
                revert("TL: call failed");
            }
        }

        emit OperationExecuted(id);
        return result;
    }

    function cancel(bytes32 id) external onlyScheduler {
        Operation storage op = operations[id];
        require(op.target != address(0), "TL: not scheduled");
        require(!op.executed, "TL: already executed");
        require(!op.cancelled, "TL: already cancelled");
        op.cancelled = true;
        emit OperationCancelled(id);
    }

    function isReady(bytes32 id) external view returns (bool) {
        Operation storage op = operations[id];
        return op.target != address(0) && !op.executed && !op.cancelled &&
            block.timestamp >= op.eta && block.timestamp <= op.eta + EXECUTION_WINDOW;
    }

    function isPending(bytes32 id) external view returns (bool) {
        Operation storage op = operations[id];
        return op.target != address(0) && !op.executed && !op.cancelled;
    }

    function getOperation(bytes32 id)
        external
        view
        returns (address target, bytes memory data, uint256 eta, bool executed, bool cancelled)
    {
        Operation storage op = operations[id];
        return (op.target, op.data, op.eta, op.executed, op.cancelled);
    }

    // ── roles ──────────────────────────────────────────────────────────

    function grantRole(bytes32 role, address account) external onlyScheduler {
        require(_knownRole(role), "TL: unknown role");
        require(account != address(0), "TL: zero account");
        _grant(role, account);
    }

    function revokeRole(bytes32 role, address account) external onlyScheduler {
        require(_knownRole(role), "TL: unknown role");
        hasRole[role][account] = false;
        emit RoleRevoked(role, account);
    }

    function renounceRole(bytes32 role) external {
        hasRole[role][msg.sender] = false;
        emit RoleRevoked(role, msg.sender);
    }

    /**
     * @notice Change the delay. Callable only by the timelock itself, so the
     *         change is itself delayed: schedule(timelock, updateDelay(x)),
     *         wait, execute.
     */
    function updateDelay(uint256 newDelay) external {
        require(msg.sender == address(this), "TL: not self");
        require(newDelay > 0, "TL: zero delay");
        emit DelayUpdated(DELAY, newDelay);
        DELAY = newDelay;
    }

    function _grant(bytes32 role, address account) internal {
        hasRole[role][account] = true;
        emit RoleGranted(role, account);
    }

    function _knownRole(bytes32 role) internal pure returns (bool) {
        return role == SCHEDULER_ROLE || role == EXECUTOR_ROLE || role == TIMELOCK_ADMIN_ROLE;
    }

    function _operationId(address target, bytes calldata data) internal returns (bytes32) {
        nonce++;
        return keccak256(abi.encode(nonce, target, data));
    }
}

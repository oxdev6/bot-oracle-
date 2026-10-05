import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

/**
 * The timelock is the only thing standing between a compromised deployer key
 * and instant parameter changes, so its role handling is tested directly:
 * roles must be per-(role, account), revocable, and the delay itself must be
 * changeable only through the timelock.
 */
describe("TimelockController", () => {
  const DELAY = 48 * 3600;
  const WINDOW = 30 * 24 * 3600;

  const fixture = async () => {
    const [deployer, multisig, stranger] = await ethers.getSigners();
    const TimelockController = await ethers.getContractFactory("TimelockController");
    const timelock: any = await TimelockController.deploy(DELAY, WINDOW);
    await timelock.waitForDeployment();

    // a trivial target so `execute` has something to call
    const Counter: any = await (await ethers.getContractFactory("TimelockCounter")).deploy();
    await Counter.waitForDeployment();

    return { timelock, Counter, deployer, multisig, stranger };
  };

  it("grants the deployer scheduler and executor roles", async () => {
    const { timelock, deployer } = await loadFixture(fixture);
    expect(await timelock.hasRole(await timelock.SCHEDULER_ROLE(), deployer.address)).to.equal(true);
    expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), deployer.address)).to.equal(true);
  });

  it("granting the scheduler role does NOT implicitly grant executor", async () => {
    const { timelock, Counter, multisig } = await loadFixture(fixture);
    const schedulerRole = await timelock.SCHEDULER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();

    await timelock.grantRole(schedulerRole, multisig.address);

    expect(await timelock.hasRole(schedulerRole, multisig.address)).to.equal(true);
    expect(await timelock.hasRole(executorRole, multisig.address)).to.equal(false);

    // …and the multisig can queue but not execute
    const data = Counter.interface.encodeFunctionData("noop");
    await timelock.connect(multisig).schedule(Counter.target, data);
    const id = await findOperationId(timelock, Counter.target, data);
    await time.increase(DELAY + 1);
    await expect(timelock.connect(multisig).execute(id)).to.be.revertedWith("TL: not executor");
  });

  it("revokes roles and refuses unknown roles / zero accounts", async () => {
    const { timelock, multisig, stranger } = await loadFixture(fixture);
    const schedulerRole = await timelock.SCHEDULER_ROLE();

    await timelock.grantRole(schedulerRole, multisig.address);
    await expect(timelock.revokeRole(schedulerRole, multisig.address)).to.emit(
      timelock,
      "RoleRevoked",
    );
    expect(await timelock.hasRole(schedulerRole, multisig.address)).to.equal(false);

    await expect(timelock.grantRole(ethers.id("NOPE"), multisig.address)).to.be.revertedWith(
      "TL: unknown role",
    );
    await expect(timelock.grantRole(schedulerRole, ethers.ZeroAddress)).to.be.revertedWith(
      "TL: zero account",
    );
    await expect(timelock.connect(stranger).grantRole(schedulerRole, stranger.address)).to.be
      .revertedWith("TL: not scheduler");
  });

  it("a stranger cannot schedule, cancel or execute", async () => {
    const { timelock, Counter, deployer, stranger } = await loadFixture(fixture);
    const data = Counter.interface.encodeFunctionData("increment");
    const id = await timelock.schedule.staticCall(Counter.target, data);
    await timelock.schedule(Counter.target, data);

    await expect(timelock.connect(stranger).schedule(Counter.target, data)).to.be.revertedWith(
      "TL: not scheduler",
    );
    await expect(timelock.connect(stranger).cancel(id)).to.be.revertedWith("TL: not scheduler");
    await expect(timelock.connect(stranger).execute(id)).to.be.revertedWith("TL: not executor");
    void deployer;
  });

  it("cannot execute before the delay, can after", async () => {
    const { timelock, Counter } = await loadFixture(fixture);
    const data = Counter.interface.encodeFunctionData("increment");
    await timelock.schedule(Counter.target, data);
    const id = await findOperationId(timelock, Counter.target, data);

    expect(await timelock.isReady(id)).to.equal(false);
    await expect(timelock.execute(id)).to.be.revertedWith("TL: delay not passed");

    await time.increase(DELAY + 1);
    expect(await timelock.isReady(id)).to.equal(true);
    await timelock.execute(id);
    expect(await Counter.value()).to.equal(1);
    await expect(timelock.execute(id)).to.be.revertedWith("TL: already executed");
  });

  it("cancelled operations never execute", async () => {
    const { timelock, Counter } = await loadFixture(fixture);
    const data = Counter.interface.encodeFunctionData("increment");
    await timelock.schedule(Counter.target, data);
    const id = await findOperationId(timelock, Counter.target, data);

    await timelock.cancel(id);
    await time.increase(DELAY + 1);
    await expect(timelock.execute(id)).to.be.revertedWith("TL: cancelled");
  });

  it("a reverting operation bubbles the original revert reason", async () => {
    const { timelock, Counter } = await loadFixture(fixture);
    const data = Counter.interface.encodeFunctionData("explode");
    await timelock.schedule(Counter.target, data);
    const id = await findOperationId(timelock, Counter.target, data);
    await time.increase(DELAY + 1);
    await expect(timelock.execute(id)).to.be.revertedWith("boom");
  });

  it("operations expire after the execution window", async () => {
    const { timelock, Counter } = await loadFixture(fixture);
    const data = Counter.interface.encodeFunctionData("increment");
    await timelock.schedule(Counter.target, data);
    const id = await findOperationId(timelock, Counter.target, data);
    await time.increase(DELAY + WINDOW + 10);
    await expect(timelock.execute(id)).to.be.revertedWith("TL: expired");
  });

  it("the delay can only be changed by the timelock itself", async () => {
    const { timelock, deployer } = await loadFixture(fixture);
    const newDelay = 72 * 3600;
    const data = timelock.interface.encodeFunctionData("updateDelay", [newDelay]);

    await timelock.schedule(timelock.target, data);
    const id = await findOperationId(timelock, timelock.target, data);

    await expect(timelock.connect(deployer).updateDelay(newDelay)).to.be.revertedWith("TL: not self");

    await time.increase(DELAY + 1);
    await timelock.execute(id);
    expect(await timelock.DELAY()).to.equal(newDelay);
  });

  it("rejects a zero delay or zero window at construction", async () => {
    const TimelockController = await ethers.getContractFactory("TimelockController");
    await expect(TimelockController.deploy(0, WINDOW)).to.be.revertedWith("TL: zero delay");
    await expect(TimelockController.deploy(DELAY, 0)).to.be.revertedWith("TL: zero window");
  });
});

/** The operation id embeds an incrementing nonce, so read it back from the map. */
async function findOperationId(timelock: any, target: string, data: string): Promise<string> {
  const count = Number(await timelock.nonce());
  for (let n = count; n >= 1; n--) {
    const id = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "bytes"], [n, target, data]),
    );
    const op = await timelock.getOperation(id);
    if (op.target === target) return id;
  }
  throw new Error("operation not found");
}

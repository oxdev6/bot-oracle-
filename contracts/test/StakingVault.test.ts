import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployOracleStack,
  MIN_STAKE,
  WITHDRAWAL_DELAY,
} from "./fixtures";

describe("StakingVault", () => {
  const fixture = async () => {
    const s = await deployOracleStack();
    // impersonate the aggregator contract so it can call vault functions
    const aggAddr = await s.aggregator.getAddress();
    await ethers.provider.send("hardhat_setBalance", [aggAddr, "0x56BC75E2D63100000"]); // 100 ETH
    const aggSigner = await ethers.getImpersonatedSigner(aggAddr);
    return { ...s, aggSigner };
  };

  async function stakeOperator(s: any, amount: bigint) {
    await s.token.connect(s.operator).approve(s.vault.target, amount);
    await s.vault.connect(s.operator).stake(amount);
  }

  describe("staking", () => {
    it("locks LODE and marks the operator eligible", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE);

      expect(await s.vault.stakeOf(op)).to.equal(MIN_STAKE);
      expect(await s.vault.isEligibleOperator(op)).to.equal(true);
      expect(await s.token.balanceOf(op)).to.equal(ethers.parseEther("50000") - MIN_STAKE);
    });

    it("rejects zero-amount stakes", async () => {
      const s = await loadFixture(fixture);
      await expect(s.vault.connect(s.operator).stake(0)).to.be.revertedWith("SV: zero amount");
    });

    it("does not mark an operator eligible below the minimum", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE - 1n);
      expect(await s.vault.isEligibleOperator(op)).to.equal(false);
    });

    it("tracks stakers and total live stake", async () => {
      const s = await loadFixture(fixture);
      expect(await s.vault.getStakerCount()).to.equal(0);
      await stakeOperator(s, MIN_STAKE);
      await stakeOperator(s, ethers.parseEther("500"));
      expect(await s.vault.getStakerCount()).to.equal(1);
      expect(await s.vault.totalStake()).to.equal(MIN_STAKE + ethers.parseEther("500"));
    });
  });

  describe("unstaking / withdrawal delay", () => {
    it("requesting a withdrawal locks funds for 7 days", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE);

      await s.vault.connect(s.operator).requestWithdrawal(MIN_STAKE);

      expect(await s.vault.totalPendingWithdrawals(op)).to.equal(MIN_STAKE);
      expect(await s.vault.effectiveStake(op)).to.equal(0);
      expect(await s.vault.isEligibleOperator(op)).to.equal(false);

      await expect(s.vault.connect(s.operator).claimWithdrawal(0)).to.be.revertedWith(
        "SV: delay active",
      );
    });

    it("claim after 7 days releases LODE", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE);
      await s.vault.connect(s.operator).requestWithdrawal(MIN_STAKE);

      await time.increase(WITHDRAWAL_DELAY + 1);

      await s.vault.connect(s.operator).claimWithdrawal(0);

      expect(await s.token.balanceOf(op)).to.equal(ethers.parseEther("50000"));
      expect(await s.vault.stakeOf(op)).to.equal(0);
      expect(await s.vault.totalPendingWithdrawals(op)).to.equal(0);
    });

    it("cannot request more than effective stake", async () => {
      const s = await loadFixture(fixture);
      await stakeOperator(s, MIN_STAKE);
      await expect(
        s.vault.connect(s.operator).requestWithdrawal(MIN_STAKE + 1n),
      ).to.be.revertedWith("SV: exceeds effective stake");
    });
  });

  describe("slashing (adversarial)", () => {
    it("only the registered aggregator can slash", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE);

      await expect(
        s.vault.connect(s.alice).slash(op, MIN_STAKE, ethers.id("bad accuracy")),
      ).to.be.revertedWith("SV: not aggregator");

      await expect(
        s.vault.connect(s.bob).slash(op, MIN_STAKE, ethers.id("liveness")),
      ).to.be.revertedWith("SV: not aggregator");
    });

    it("aggregator slash reduces stake and transfers funds to treasury", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      const treasuryAddr = await s.treasury.getAddress();
      await stakeOperator(s, MIN_STAKE);
      const vaultBalanceBefore = await s.token.balanceOf(s.vault.target);
      const treasuryBalanceBefore = await s.token.balanceOf(treasuryAddr);

      const slashAmount = ethers.parseEther("100");
      await s.vault.connect(s.aggSigner).slash(op, slashAmount, ethers.id("bad accuracy"));

      expect(await s.vault.stakeOf(op)).to.equal(MIN_STAKE - slashAmount);
      expect(await s.token.balanceOf(treasuryAddr)).to.equal(treasuryBalanceBefore + slashAmount);
      expect(await s.token.balanceOf(s.vault.target)).to.equal(vaultBalanceBefore - slashAmount);
    });

    it("operator CANNOT dodge slashing by requesting withdrawal first", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE);

      await s.vault.connect(s.operator).requestWithdrawal(MIN_STAKE);
      expect(await s.vault.totalPendingWithdrawals(op)).to.equal(MIN_STAKE);

      await s.vault.connect(s.aggSigner).slash(op, MIN_STAKE, ethers.id("cheating"));

      expect(await s.vault.totalPendingWithdrawals(op)).to.equal(0);
      expect(await s.vault.stakeOf(op)).to.equal(0);

      await expect(s.vault.connect(s.operator).claimWithdrawal(0)).to.be.revertedWith("SV: already claimed");
    });

    it("partial slash proportionally cancels pending requests", async () => {
      const s = await loadFixture(fixture);
      const op = await s.operator.getAddress();
      await stakeOperator(s, MIN_STAKE);

      await s.vault.connect(s.operator).requestWithdrawal(ethers.parseEther("500"));

      await s.vault.connect(s.aggSigner).slash(op, ethers.parseEther("600"), ethers.id("bad accuracy"));

      expect(await s.vault.stakeOf(op)).to.equal(MIN_STAKE - ethers.parseEther("600"));
      expect(await s.vault.totalPendingWithdrawals(op)).to.equal(0);
    });

    it("cannot slash an operator with no stake", async () => {
      const s = await loadFixture(fixture);
      await expect(
        s.vault.connect(s.aggSigner).slash(await s.alice.getAddress(), MIN_STAKE, ethers.id("x")),
      ).to.be.revertedWith("SV: no stake");
    });
  });

  describe("rewards", () => {
    it("distributeRewards pays only the listed operators (aggregator-only)", async () => {
      const s = await loadFixture(fixture);
      const alice = await s.alice.getAddress();
      const bob = await s.bob.getAddress();
      const amt = ethers.parseEther("10");

      const aliceBefore = await s.token.balanceOf(alice);
      const bobBefore = await s.token.balanceOf(bob);

      await s.vault.connect(s.aggSigner).distributeRewards(
        [alice, bob],
        [amt, amt],
      );

      expect(await s.token.balanceOf(alice)).to.equal(aliceBefore + amt);
      expect(await s.token.balanceOf(bob)).to.equal(bobBefore + amt);
    });

    it("non-aggregator cannot distribute rewards", async () => {
      const s = await loadFixture(fixture);
      await expect(
        s.vault.connect(s.alice).distributeRewards([await s.alice.getAddress()], [1]),
      ).to.be.revertedWith("SV: not aggregator");
    });

    it("reverts if the vault lacks funds for the total", async () => {
      const s = await loadFixture(fixture);
      const huge = ethers.parseEther("9999999");
      await expect(
        s.vault.connect(s.aggSigner).distributeRewards(
          [await s.alice.getAddress()],
          [huge],
        ),
      ).to.be.revertedWith("SV: insufficient funds");
    });
  });

  describe("admin (timelock-owned)", () => {
    it("setMinStake requires vault owner (timelock) — regular owner reverts", async () => {
      const s = await loadFixture(fixture);
      // vault ownership is now the timelock
      await expect(
        s.vault.connect(s.owner).setMinStake(ethers.parseEther("2000")),
      ).to.be.reverted;
    });

    it("fundRewards tops up the vault balance", async () => {
      const s = await loadFixture(fixture);
      const before = await s.token.balanceOf(s.vault.target);
      const amt = ethers.parseEther("5");
      await s.token.connect(s.treasury).approve(s.vault.target, amt);
      await s.vault.connect(s.treasury).fundRewards(amt);
      expect(await s.token.balanceOf(s.vault.target)).to.equal(before + amt);
    });
  });
});
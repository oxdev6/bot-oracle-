import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { TOTAL_SUPPLY } from "./fixtures";

describe("LodestarToken (LODE)", () => {
  async function deployToken() {
    const [treasury, alice, bob] = await ethers.getSigners();
    const LodestarToken = await ethers.getContractFactory("LodestarToken");
    const token: any = await LodestarToken.deploy(
      await treasury.getAddress(),
      TOTAL_SUPPLY,
    );
    await token.waitForDeployment();
    return { token, treasury, alice, bob };
  }

  it("mints the full fixed supply to the treasury at deploy", async () => {
    const { token, treasury } = await loadFixture(deployToken);
    const treasuryAddr = await treasury.getAddress();
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(treasuryAddr)).to.equal(TOTAL_SUPPLY);
    expect(await token.MAX_SUPPLY()).to.equal(TOTAL_SUPPLY);
  });

  it("uses the standard name/symbol/decimals", async () => {
    const { token } = await loadFixture(deployToken);
    expect(await token.name()).to.equal("Lodestar");
    expect(await token.symbol()).to.equal("LODE");
    expect(await token.decimals()).to.equal(18);
    expect(await token.treasury()).to.equal(
      await (await ethers.getSigners())[0].getAddress(),
    );
  });

  it("transfers normally between holders", async () => {
    const { token, treasury, alice } = await loadFixture(deployToken);
    const amt = ethers.parseEther("100");
    const aliceAddr = await alice.getAddress();
    await token.connect(treasury).transfer(aliceAddr, amt);
    expect(await token.balanceOf(aliceAddr)).to.equal(amt);
    expect(await token.balanceOf(await treasury.getAddress())).to.equal(
      TOTAL_SUPPLY - amt,
    );
  });

  it("total supply never changes after transfers", async () => {
    const { token, treasury, alice, bob } = await loadFixture(deployToken);
    const amt = ethers.parseEther("500");
    const aliceAddr = await alice.getAddress();
    const bobAddr = await bob.getAddress();
    await token.connect(treasury).transfer(aliceAddr, amt);
    await token.connect(alice).transfer(bobAddr, amt / 2n);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
  });

  it("has no mint function reachable by any key (ABI check)", async () => {
    const { token } = await loadFixture(deployToken);
    const functions = token.interface.fragments
      .filter((f: any) => f.type === "function")
      .map((f: any) => f.name);
    expect(functions).not.to.include("mint");
    expect(functions).not.to.include("burn");
  });

  it("cannot be transferred without allowance from a non-owner", async () => {
    const { token, treasury, alice } = await loadFixture(deployToken);
    const treasuryAddr = await treasury.getAddress();
    const aliceAddr = await alice.getAddress();
    const amt = ethers.parseEther("1");
    await expect(
      token.connect(alice).transferFrom(treasuryAddr, aliceAddr, amt),
    ).to.be.reverted;
  });

  it("rejects native token transfers", async () => {
    const { token, alice } = await loadFixture(deployToken);
    await expect(
      alice.sendTransaction({
        to: token.target,
        value: ethers.parseEther("1"),
      }),
    ).to.be.reverted;
  });
});
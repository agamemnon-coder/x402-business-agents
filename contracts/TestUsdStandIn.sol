// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// A stand-in for Metal's *USDZ in Purser's in-memory chain only (npm run tokenize -- stand-in and the tests). It is
/// never deployed to a network: live runs settle in Metal's own *USDZ. 18 decimals, as *USDZ. Anyone can mint: it is
/// test money inside one process.
contract TestUsdStandIn is ERC20 {
    constructor() ERC20("Test USD stand-in", "tUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

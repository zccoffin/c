const settings = require("../config/config");
const { sleep } = require("../utils");

class MiningSV {
  constructor({ makeRequest, log }) {
    this.userData = null;
    this.makeRequest = makeRequest;
    this.log = log;
  }
}

module.exports = MiningSV;

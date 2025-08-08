const settings = require("../config/config");
const { sleep } = require("../utils");

class TaskSV {
  constructor({ makeRequest, log, handleConnectTonWallet }) {
    this.userData = null;
    this.makeRequest = makeRequest;
    this.log = log;
    this.handleConnectTonWallet = handleConnectTonWallet;
  }

  async getTask() {
    return await this.makeRequest(`${settings.BASE_URL}/tasks`, "get");
  }

  async completeTask(taskid) {
    return await this.makeRequest(`${settings.BASE_URL}/tasks/${taskid}/verify`, "post");
  }

  async handleTasks() {
    const tasks = await this.getTask();
    if (!tasks.success) return;
    const taskavaliable = tasks.data.filter((t) => t.active && !settings.SKIP_TASKS.includes(t.id));
    if (taskavaliable.length == 0) return this.log(`No task avaliable!`, "warning");
    for (const task of taskavaliable) {
      await sleep(3);
      const { id, code, title } = task;
      if (id == 7) {
        await this.handleConnectTonWallet();
      }
      this.log(`Completing task ${title} (${id})`);
      const resClaim = await this.completeTask(id);
      if (!resClaim.success) {
        this.log(`Verify task ${id} failed | ${JSON.stringify(resClaim)}`, "warning");
      } else {
        this.log(`Verify task ${id} success`, "success");
      }
    }
  }
}

module.exports = TaskSV;

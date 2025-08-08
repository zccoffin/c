const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson } = require("./utils");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");
const TaskSV = require("./services/task");
const walllets = loadData("wallets.txt");
class ClientAPI {
  constructor(queryId, accountIndex, proxy, baseURL, tokens) {
    this.headers = new Headers({
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      origin: "https://app.cross-play.xyz",
      referer: "https://app.cross-play.xyz/",
      "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    });
    this.baseURL = baseURL;
    this.queryId = queryId;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.tokens = tokens;
    this.token = null;
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Windows";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      const telegramauth = this.queryId;
      const userData = JSON.parse(decodeURIComponent(telegramauth.split("user=")[1].split("&")[0]));
      this.session_name = userData.id;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent, try get new query_id: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[Tài khoản ${this.accountIndex + 1}]`;
    let ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Local IP]";
    let logMessage = "";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 1,
      isAuth: false,
      extraHeaders: {},
    }
  ) {
    const initOptions = {
      retries: 2,
      isAuth: false,
      extraHeaders: {},
      ...options,
    };
    const { retries, isAuth, extraHeaders } = initOptions;

    const headers = {
      ...this.headers,
      ...extraHeaders,
    };

    if (!isAuth) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }
    let currRetries = 0,
      success = false;
    do {
      try {
        const response = await axios({
          method,
          url: `${url}`,
          data,
          headers,
          timeout: 30000,

          ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
        });
        success = true;
        return { status: response.status, success: true, data: response.data?.data || response.data };
      } catch (error) {
        if (error.status == 401) {
          if (url.includes("/login")) {
            this.log("Token expired, please get new your query_id manually", "error");
            return { success: false, status: error.status, error: error.response.data.error || error.response.data.message || error.message };
          }
          const token = await this.getValidToken(true);
          if (!token) {
            process.exit(0);
          }
          this.token = token;
          if (retries > 0)
            return await this.makeRequest(url, method, data, {
              ...options,
              retries: 0,
            });
          else return { success: false, status: error.status, error: error.response.data.error || error.response.data.message || error.message };
        }
        if (error.status == 400) {
          return { success: false, status: error.status, error: error.response.data.error || error.response.data.message || error.message };
        }
        success = false;
        await sleep(settings.DELAY_BETWEEN_REQUESTS);
        if (currRetries == retries) return { status: error.status, success: false, error: error.message };
      }
      currRetries++;
    } while (currRetries <= retries && !success);
  }

  async auth() {
    return this.makeRequest(
      `${this.baseURL}/users/login`,
      "post",
      {
        encodedMessage: this.queryId,
      },
      { isAuth: true }
    );
  }

  async getUserInfo() {
    return this.makeRequest(`${this.baseURL}/characters/character-info`, "get");
  }

  async claimMining() {
    return await this.makeRequest(`${settings.BASE_URL}/users/golds/claim`, "post");
  }

  async connectWallet() {
    return this.makeRequest(`${this.baseURL}/wallets`, "post", {
      address: walllets[this.accountIndex],
      type: "TON",
    });
  }

  async checkDailyBox() {
    return this.makeRequest(`${this.baseURL}/shops/daily-item-box`, "get");
  }

  async claimDailyBox() {
    return this.makeRequest(`${this.baseURL}/shops/daily-item-box/receive`, "post");
  }

  async levelUpReward() {
    return this.makeRequest(`${this.baseURL}/level-up-rewards/new`, "get");
  }

  async claimLevelUpReward() {
    return this.makeRequest(`${this.baseURL}/level-up-rewards/claim-all`, "post");
  }

  async checkBoxOpen() {
    return this.makeRequest(`${this.baseURL}/item-boxes/unopened`, "get");
  }

  async openBox() {
    return this.makeRequest(`${this.baseURL}/item-boxes`, "post");
  }

  async getCode() {
    return this.makeRequest(`${this.baseURL}/invitations/code`, "get");
  }

  async getValidToken(isNew = false) {
    const existingToken = this.token;
    const isExp = isTokenExpired(existingToken);
    if (existingToken && !isNew && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    } else {
      this.log("No found token or experied, trying get new token...", "warning");
      const newToken = await this.auth();
      if (newToken.success && newToken.data?.accessToken) {
        this.token = newToken.data.accessToken;
        await saveJson(this.session_name, newToken.data.accessToken, "tokens.json");
        return newToken.data.accessToken;
      }
      this.log("Can't get new token...", "warning");
      return null;
    }
  }

  canClaimMining({ beforeClaimedAt, autoMiningMinutes }) {
    const lastClaimedAt = new Date(beforeClaimedAt);

    // Tính thời gian tiếp theo để claim
    const nextClaimTime = new Date(lastClaimedAt.getTime() + autoMiningMinutes * 60000);

    // Thời gian hiện tại
    const now = new Date();

    // Kiểm tra xem đã đến thời gian claim chưa
    if (now < nextClaimTime) {
      this.log(`Next claim mining: ${nextClaimTime.toLocaleString()}`, "warning");
      return false;
    } else {
    }
    return true;
  }

  async handleTasks() {
    const taskSV = new TaskSV({
      log: (type, mess) => this.log(type, mess),
      makeRequest: (url, method, data, options) => this.makeRequest(url, method, data, options),
      handleConnectTonWallet: () => this.handleConnectTonWallet(),
    });
    await taskSV.handleTasks();
  }
  async handleDailybox() {
    const res = await this.checkDailyBox();
    if (!res.success || !res.data.bool) return;
    const result = await this.claimDailyBox();
    if (result.success) {
      this.log(`Claim daily box success`, "success");
    }
  }

  async handleLevelUp() {
    const res = await this.levelUpReward();
    if (!res.success || !res.data.bool) return;
    const result = await this.claimLevelUpReward();
    if (result.success) {
      this.log(`Claim reward level up success`, "success");
    }
  }

  async handleOpenBox() {
    const res = await this.checkBoxOpen();
    if (!res.success) return;
    const boxUnOpen = res.data.filter((t) => !t.opened);
    if (boxUnOpen.length == 0) return;
    const result = await this.openBox();
    if (result.success) {
      this.log(`Open box success`, "success");
    }
  }

  async handleConnectTonWallet() {
    if (!walllets[this.accountIndex]) return;
    this.log(`Connecting to wallet ${walllets[this.accountIndex]}`);
    const res = await this.connectWallet();
    console.log(res);
    if (res.success) {
      this.log(`Connect ton wallet success`, "success");
    }
  }

  async runAccount() {
    const accountIndex = this.accountIndex;
    const initData = this.queryId;
    const queryData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
    this.session_name = queryData.id;
    this.token = this.tokens[this.session_name];
    this.#set_headers();

    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      console.log(`=========Tài khoản ${accountIndex + 1} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
      await sleep(timesleep);
    }

    let token = await this.getValidToken();
    if (!token) return;
    this.token = token;
    let userData = { success: false },
      retries = 0;
    do {
      userData = await this.getUserInfo();
      if (userData?.success) break;
      retries++;
    } while (retries < 2);
    const { data: refCode } = await this.getCode();
    // process.exit(0);
    if (userData.success) {
      let { goldAmount, gemAmount, currentLevel, autoMiningInfo } = userData.data;
      const { autoMiningMinutes, beforeClaimedAt } = autoMiningInfo;

      this.log(`Ref code: ${refCode.code || "Unknow"} | Level: ${currentLevel.value} | Gold: ${goldAmount} | Diamond: ${gemAmount}`, "custom");
      if (!beforeClaimedAt || this.canClaimMining({ autoMiningMinutes, beforeClaimedAt })) {
        const harvestResult = await this.claimMining();
        if (harvestResult.success) {
          this.log(`Claim mining success!`, "success");
        } else {
          this.log(`Claim mining failed! | ${JSON.stringify(harvestResult)}`, "warning");
        }
      }
      await sleep(1);

      await this.handleDailybox();
      await sleep(1);
      await this.handleLevelUp();
      await sleep(1);
      await this.handleOpenBox();
      await sleep(1);

      await this.handleTasks();
      await sleep(1);
    } else {
      return this.log("Can't get use info...skipping", "error");
    }
  }
}

async function runWorker(workerData) {
  const { queryId, accountIndex, proxy, hasIDAPI, tokens } = workerData;
  const to = new ClientAPI(queryId, accountIndex, proxy, hasIDAPI, tokens);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)".yellow);
  const queryIds = loadData("data.txt");
  const proxies = loadData("proxy.txt");
  const tokens = require("./tokens.json");

  if (queryIds.length == 0 || (queryIds.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }
  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const { endpoint: hasIDAPI, message } = await checkBaseUrl();
  if (!hasIDAPI) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);
  // process.exit();
  queryIds.map((val, i) => new ClientAPI(val, i, proxies[i], hasIDAPI, tokens).createUserAgent());

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < queryIds.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, queryIds.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI,
            queryId: queryIds[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex],
            tokens: tokens,
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (settings.ENABLE_DEBUG) {
                console.log(message);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < queryIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    await sleep(3);
    console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)".yellow);
    console.log(`=============Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}

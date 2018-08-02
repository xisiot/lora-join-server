'use strict';

const loraLib = require('../lora-lib');
const {consts, utils, ERROR} = loraLib;
const http = require('../../config').http;

const cmac = require('node-aes-cmac').aesCmac;
const slice = utils.bufferSlice;
const crypto = require('crypto');
const rp = require('request-promise');
const rpError = require('request-promise/errors');
const bluebird = require('bluebird');

const merge = utils.mergeObjWithBuf;
const reverse = utils.bufferReverse;
const bitwiseAssigner = utils.bitwiseAssigner;

const freqList = consts.FREQUENCY_PLAN_LIST;
const argmin = (arr) => arr.indexOf(Math.min(...arr));
const getFreqPlan = (freq, freqList) => freqList[argmin(freqList.map((ele) => Math.abs(ele - freq)))];

const DLSettingsPackager = (RX1DRoffset, RX2DR) => {
  const OptNeg = 1;
  let DLSettings = Buffer.alloc(consts.DLSETTINGS_LEN);
  DLSettings = bitwiseAssigner(DLSettings, consts.OPTNEG_OFFSET, consts.OPTNEG_LEN, OptNeg);
  DLSettings = bitwiseAssigner(DLSettings, consts.RX1DROFFSET_OFFSET, consts.RX1DROFFSET_LEN, RX1DRoffset);
  DLSettings = bitwiseAssigner(DLSettings, consts.RX2DR_OFFSET, consts.RX2DR_LEN, RX2DR);
  return DLSettings;
};

const RxDelayPackager = (RxDelay, delay) => bitwiseAssigner(RxDelay, consts.RXDELAY_BITOFFSET, consts.RXDELAY_BITLEN, delay);
  
class JoinHandler {
  constructor (modelIns, config, log) {
    this.NetID = Buffer.alloc(consts.NETID_LEN);
    this.DeviceInfo = modelIns.MySQLModel.DeviceInfo;
    this.DeviceConfig = modelIns.MySQLModel.DeviceConfig;
    this.log = log;
    this.config = config;
  }

  readDevice (queryOpt) {
    const attributes = [
      'DevAddr',
      'AppKey',
    ];
    return this.DeviceInfo
    .readItem(queryOpt, attributes)
    .then((res) => {
      if (res.AppKey) {
        return bluebird.resolve(res);
      } else {
        const errorMessage = {
          message: 'Device not registered on LoRa web server',
          DevEUI: this.joinReq.DevEUI,
          AppEUI: this.joinReq.AppEUI,
        };
        return bluebird.reject(new ERROR.DeviceNotExistError(errorMessage));
      }

    });
  }

  genAcpt (joinReq, DLSettings, RxDelay) {
    //CFLIST TODO
    const joinAcpt = {
      AppNonce: this.AppNonce,
      NetID: this.NetID,
      DevAddr: this.DevAddr,
      DLSettings: DLSettings,
      RxDelay: RxDelay,
      // CFList: this.defaultConf.CFList,
    };
    const nonce = {
      DevNonce: joinReq.DevNonce,
      AppNonce: this.AppNonce,
      NetID: this.NetID,
    };

    const NwkSKey = JoinHandler.genSKey(this.AppKey, nonce, 'NWK');
    const AppSKey = JoinHandler.genSKey(this.AppKey, nonce, 'APP');
    const sKey = {
      NwkSKey: NwkSKey,
      AppSKey: AppSKey,
    };
    const acpt = merge(joinAcpt, sKey);

    return acpt;
  }

  handler (rxpk) {
    const joinReqPayload = rxpk.data;
    const freq = rxpk.freq;

    //Check the length of join request
    // const requiredLength = consts.APPEUI_LEN + consts.DEVEUI_LEN + consts.DEVNONCE_LEN;

    // const receivedLength = joinReqPHYPayload.MACPayload.length;
    const joinReq = this.joinReqParser(joinReqPayload.MACPayload);
    this.joinReq = joinReq;
    const joinReqMHDR = joinReqPayload.MHDR;
    const joinReqMIC = joinReqPayload.MIC;

    const appKeyQueryOpt = {
      DevEUI: joinReq.DevEUI,
    };
    const frequencyPlan = getFreqPlan(freq, freqList);
    this.defaultConf = consts.DEFAULTCONF[frequencyPlan];
    
    // Query the existance of DevEUI
    // If so, process the rejoin procedure
    
    this.AppNonce = crypto.randomBytes(consts.APPNONCE_LEN);

    // Promises
    const rejoinProcedure = (res) => {
      if (res.DevAddr) {
        this.DevAddr = res.DevAddr;
      } else {
        this.DevAddr = JoinHandler.genDevAddr(
          joinReq.AppEUI,
          joinReq.DevEUI,
          this.NetID.slice(consts.NWKID_OFFSET, consts.NWKID_OFFSET + consts.NWKID_LEN)
        );
      }

      return bluebird.resolve(this.DevAddr);
    };

    const initDeviceConf = (deviceConf) => {
      const query = { DevAddr: deviceConf.DevAddr, };
      return this.DeviceConfig.upsertItem(deviceConf, query);
    };

    const joinReqMICVerification = (res) => {
      this.AppKey = res.AppKey;
      const MHDR = joinReqPayload.MHDRRaw;
      const micRequiredFields = Object.assign({}, joinReq);
      micRequiredFields.MHDR = MHDR;
      return JoinHandler.micVerification(micRequiredFields, res, joinReqMIC);
    };

    const updateDevInfo = (DevAddr) => {
      const RX1DRoffset = 4;
      const RX2DR = 0;
      const delay = 1;
      this.DLSettings = DLSettingsPackager(RX1DRoffset, RX2DR);
      this.RxDelay = Buffer.alloc(consts.RXDELAY_LEN);
      this.RxDelay = RxDelayPackager(this.RxDelay, delay);
      this.acpt = this.genAcpt(joinReq, this.DLSettings, this.RxDelay);
      const deviceInfoUpd = {
        DevAddr: DevAddr,
        DevNonce: joinReq.DevNonce,
        AppNonce: this.AppNonce,
        NwkSKey: this.acpt.NwkSKey,
        AppSKey: this.acpt.AppSKey,
      };

      const logMessage = {
        DevAddr: DevAddr,
        DevEUI: joinReq.DevEUI,
        AppEUI: joinReq.AppEUI,
      };
      this.DevAddr = DevAddr;
      this.log.info(logMessage);
      this.defaultConf.DevAddr = DevAddr;
      this.defaultConf.RX1DRoffset = RX1DRoffset;

      return this.DeviceInfo.updateItem(appKeyQueryOpt, deviceInfoUpd)
      .then(() => initDeviceConf(this.defaultConf));
    };

    const returnAcptMsg = () => {
      const acptPHY = JoinHandler.joinAcptPHYPackager(this.acpt, this.AppKey);
      return bluebird.resolve(acptPHY);
    };

    return this.readDevice(appKeyQueryOpt)
      .then(joinReqMICVerification)
      .then(rejoinProcedure)
      .then(updateDevInfo)
      .then(returnAcptMsg)
  }

  joinReqParser (MACPayload) {
    const joinReqJSON = {};
    joinReqJSON.AppEUI = slice(MACPayload, consts.JOINEUI_OFFSET, consts.DEVEUI_OFFSET);
    joinReqJSON.DevEUI = slice(MACPayload, consts.DEVEUI_OFFSET, consts.DEVNONCE_OFFSET);
    joinReqJSON.DevNonce = slice(MACPayload, consts.DEVNONCE_OFFSET);
    return joinReqJSON;

  }

}

//Class methods or Static methods

JoinHandler.genDevAddr = (AppEUI, DevEUI, NwkID) => {
  const hash = crypto.createHash(consts.HASH_METHOD);
  const eui = Buffer.concat([AppEUI, DevEUI], consts.APPEUI_LEN + consts.DEVEUI_LEN);
  const devAddr = hash.update(eui).digest().slice(0, consts.DEVADDR_LEN - 1);
  return Buffer.concat([NwkID, devAddr]);
};

JoinHandler.genSKey = (AppKey, nonce, type) => {
  let sessionBuf = Buffer.alloc(consts.BLOCK_LEN);
  type = type || 'NWK';
  if (type === 'NWK') {
    sessionBuf[0] = 0x01;
  } else if (type === 'APP') {
    sessionBuf[0] = 0x02;
  }

  const appnonce = reverse(nonce.AppNonce);
  const netid = reverse(nonce.NetID);
  const devnonce = reverse(nonce.DevNonce);

  appnonce.copy(sessionBuf, consts.SK_APPNONCE_OFFSET);
  netid.copy(sessionBuf, consts.SK_NETID_OFFSET);
  devnonce.copy(sessionBuf, consts.SK_DEVNONCE_OFFSET);

  const iv = '';//crypto.randomBytes(consts.IV_LEN);
  const cipher = crypto.createCipheriv(consts.ENCRYPTION_ALGO, AppKey, iv);
  const sessionKey = cipher.update(sessionBuf, 'binary');
  return sessionKey;
};

JoinHandler.joinAcptPHYPackager = (joinAcpt, AppKey) => {
  const MHDR = JoinHandler.MHDRPackager();
  const MHDRJSON = {
    MType: consts.JOIN_ACCEPT,
    Major: consts.MAJOR_DEFAULT,
  };
  const micPayloadJSON = Object.assign({}, joinAcpt);
  micPayloadJSON.MHDR = MHDR;
  const MIC = JoinHandler.joinMICCalculator(micPayloadJSON, AppKey, 'accept');
  const encryptingFields = Object.assign({}, joinAcpt);
  encryptingFields.MIC = MIC;
  const acptEncrypted = JoinHandler.AcptEncryption(encryptingFields, AppKey);
  return {
    MHDR: MHDRJSON,
    MACPayload: acptEncrypted,
    DevAddr: joinAcpt.DevAddr,
  };
};

JoinHandler.AcptEncryption = (encryptingFields, key) => {
  let encryptingPayload = Buffer.concat([
    reverse(encryptingFields.AppNonce),
    reverse(encryptingFields.NetID),
    reverse(encryptingFields.DevAddr),
    reverse(encryptingFields.DLSettings),
    reverse(encryptingFields.RxDelay)
  ], consts.BLOCK_LEN_ACPT_BASE);
  if (encryptingFields.hasOwnProperty('CFList')) {
    encryptingPayload = Buffer.concat([
      encryptingPayload,
      reverse(encryptingFields.CFList)
    ], consts.BLOCK_LEN_ACPT_BASE + encryptingFields.CFList.length);
  }

  encryptingPayload = Buffer.concat([
    encryptingPayload,
    encryptingFields.MIC
  ], encryptingPayload.length + consts.MIC_LEN);
  const iv = '';
  const cipher = crypto.createDecipheriv(consts.ENCRYPTION_ALGO, key, iv);
  cipher.setAutoPadding(false);
  return cipher.update(encryptingPayload);
};

JoinHandler.joinMICCalculator = (requiredFields, key, type) => {
  let micPayload;
  let bufferArray;
  switch (type) {
    case 'request': {
      bufferArray = [
        reverse(requiredFields.MHDR),
        reverse(requiredFields.AppEUI),
        reverse(requiredFields.DevEUI),
        reverse(requiredFields.DevNonce)
      ];
      micPayload = Buffer.concat(bufferArray, consts.BLOCK_LEN_REQ_MIC); 
      break;
    }
    case 'accept': {
      bufferArray = [
        reverse(requiredFields.MHDR),
        reverse(requiredFields.AppNonce),
        reverse(requiredFields.NetID),
        reverse(requiredFields.DevAddr),
        reverse(requiredFields.DLSettings),
        reverse(requiredFields.RxDelay)
      ];
      micPayload = Buffer.concat(bufferArray, consts.BLOCK_LEN_ACPT_MIC_BASE);
      if (Object.hasOwnProperty('CFList')) {
        micPayload = Buffer.concat([
          micPayload,
          reverse(requiredFields.CFList)
        ], consts.BLOCK_LEN_ACPT_MIC_BASE + requiredFields.CFList.length);
      }

      break;
    }
  }
  const options = {
    returnAsBuffer: true,
  };

  return cmac(
    key,
    micPayload,
    options
  ).slice(0, consts.V102_CMAC_LEN);
};

JoinHandler.micVerification = (requiredFields, res, receivedMIC) => {
  const AppKey = res.AppKey;
  return new bluebird((resolve, reject) => {
    const calculatedMIC = JoinHandler.joinMICCalculator(requiredFields, AppKey, 'request');
    if (receivedMIC.equals(calculatedMIC)) {
      return resolve(res);
    } else {
      const errorMessage = {
        message: 'MIC dismatch',
        DevEUI: requiredFields.DevEUI,
        AppEUI: requiredFields.AppEUI,
      };
      return reject(new ERROR.MICDismatchError(errorMessage));
    }

  });
};

JoinHandler.MHDRPackager = () => {
  let MHDR = Buffer.alloc(consts.MHDR_LEN);
  MHDR = utils.bitwiseAssigner(MHDR, consts.MTYPE_OFFSET, consts.MTYPE_LEN, consts.JS_MSG_TYPE.accept);
  MHDR = utils.bitwiseAssigner(MHDR, consts.MAJOR_OFFSET, consts.MAJOR_LEN, consts.MAJOR_DEFAULT);
  return MHDR;
};

module.exports = JoinHandler;

'use strict';

const loraLib = require('../lora-lib');
const {consts, utils, ERROR} = loraLib;
const http = require('../../config').http;

const slice = utils.bufferSlice;
const crypto = require('crypto');
const bluebird = require('bluebird');

const merge = utils.mergeObjWithBuf;
const reverse = utils.bufferReverse;
const bitwiseAssigner = utils.bitwiseAssigner;

const freqList = consts.FREQUENCY_PLAN_LIST;
const argmin = (arr) => arr.indexOf(Math.min(...arr));
const getFreqPlan = (freq, freqList) => freqList[argmin(freqList.map((ele) => Math.abs(ele - freq)))];

const DLSettingsPackager = (RX1DRoffset, ProtocolVersion, RX2DR) => {
  let OptNeg;
  if(ProtocolVersion == '1.1'){
    OptNeg = 1;
  }
  else{
    OptNeg = 0;
  }
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
    let attributes;
    if(queryOpt.JoinEUI){
      attributes = [
        'DevAddr',
        'NwkKey',
        'AppKey',
        'ProtocolVersion',
      ]; 
      this.JoinEUI = queryOpt.JoinEUI;
      } else {
      attributes = [
        'DevAddr',
        'NwkKey',
        'AppKey',
        'JoinEUI',
        'ProtocolVersion',
        ];
      }
    return this.DeviceInfo
    .readItem(queryOpt, attributes)
    .then((res) => {
      if (res.AppKey) {
        this.AppKey = res.AppKey;
        this.ProtocolVersion = res.ProtocolVersion;
        if(res.NwkKey){
          this.NwkKey = res.NwkKey;
        }
        if(res.JoinEUI){
          this.JoinEUI = res.JoinEUI
        } 
        return bluebird.resolve(res);
      } else {
        const errorMessage = {
          message: 'Device not registered on LoRa web server',
          DevEUI: this.joinReq.DevEUI,
          JoinEUI: this.JoinEUI,
        };
        return bluebird.reject(new ERROR.DeviceNotExistError(errorMessage));
      }

    });
  }

  genAcpt (joinReq, DLSettings, RxDelay) {
    //CFLIST TODO
    const joinAcpt = {
      JoinNonce: this.JoinNonce,
      NetID: this.NetID,
      DevAddr: this.DevAddr,
      DLSettings: DLSettings,
      RxDelay: RxDelay,
      // CFList: this.defaultConf.CFList,
    };
    const nonce = {
      DevNonce: this.DevNonce,
      JoinNonce: this.JoinNonce,
      DevEUI:joinReq.DevEUI,
      JoinEUI:this.JoinEUI,
      NetID: this.NetID,
    };
    const JSIntKey = JoinHandler.genSKey(this.NwkKey, this.ProtocolVersion,nonce, 'JSINT');
    const JSEncKey = JoinHandler.genSKey(this.NwkKey, this.ProtocolVersion, nonce, 'JSENC');
    const SNwkSIntKey = JoinHandler.genSKey(this.NwkKey, this.ProtocolVersion, nonce, 'SNWKSINT');
    const FNwkSIntKey = JoinHandler.genSKey(this.NwkKey, this.ProtocolVersion, nonce, 'FNWKSINT');
    const NwkSEncKey = JoinHandler.genSKey(this.NwkKey, this.ProtocolVersion, nonce, 'NWKSENC');
    const AppSKey = JoinHandler.genSKey(this.AppKey, this.ProtocolVersion, nonce, 'APP');
    const sKey = {
      JSIntKey:JSIntKey,
      JSEncKey:JSEncKey,
      SNwkSIntKey:SNwkSIntKey,
      FNwkSIntKey:FNwkSIntKey,
      NwkSEncKey: NwkSEncKey,
      AppSKey: AppSKey,
    };
    joinAcpt.sKey = sKey;

    return joinAcpt;
  }

  handler (rxpk) {
    const joinReqPayload = rxpk.data;
    const freq = rxpk.freq;
    //Check the length of join request
    // const requiredLength = consts.APPEUI_LEN + consts.DEVEUI_LEN + consts.DEVNONCE_LEN;

    // const receivedLength = joinReqPHYPayload.MACPayload.length;
    let JoinReqType;
    const RejoinMType = Buffer.from('c0','hex');
    const joinReq = joinReqPayload.MACPayload;
    this.joinReq = joinReq;
    const joinReqMHDR = joinReqPayload.MHDR;
    const DevNonce = joinReq.DevNonce;
    this.DevNonce = DevNonce;
    if(joinReqMHDR.equals(RejoinMType)){
      if((joinReq.RejoinType).equals(consts.RejoinType_0)){
        JoinReqType = consts.RejoinType_0;
      } else if((joinReq.RejoinType).equals(consts.RejoinType_1)){
        JoinReqType = consts.RejoinType_1;
      } else {
        JoinReqType = consts.RejoinType_2;
      }
    } else {
      JoinReqType = consts.JoinType;
    } 
    this.JoinReqType = JoinReqType;
    let appKeyQueryOpt;
    if(joinReq.JoinEUI){
      appKeyQueryOpt = {
        DevEUI: joinReq.DevEUI,
        JoinEUI:joinReq.JoinEUI,
      };
    } else {
      appKeyQueryOpt = {
        DevEUI: joinReq.DevEUI,
      };
    }

    const frequencyPlan = getFreqPlan(freq, freqList);
    this.defaultConf = consts.DEFAULTCONF[frequencyPlan];
    
    // Query the existance of DevEUI
    // If so, process the rejoin procedure
    
    this.JoinNonce = crypto.randomBytes(consts.JOINNONCE_LEN);

    // Promises
    const rejoinProcedure = (res) => {
      if (res.DevAddr) {
        this.DevAddr = res.DevAddr;
      } else {
        this.DevAddr = JoinHandler.genDevAddr(
          this.JoinEUI,
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

    const updateDevInfo = (DevAddr) => {
      const RX1DRoffset = 4;
      const RX2DR = 0;
      const delay = 1;
      this.DLSettings = DLSettingsPackager(RX1DRoffset, this.ProtocolVersion, RX2DR);
      this.RxDelay = Buffer.alloc(consts.RXDELAY_LEN);
      this.RxDelay = RxDelayPackager(this.RxDelay, delay);
      this.acpt = this.genAcpt(joinReq, this.DLSettings, this.RxDelay);
      let deviceInfoUpd;
      if(this.ProtocolVersion === '1.1'){
        if(this.JoinReqType === consts.RejoinType_1){
          deviceInfoUpd = {
            DevAddr: DevAddr,
            RJcount1: this.DevNonce,
            JoinNonce: this.JoinNonce,
            JSIntKey:this.acpt.sKey.JSIntKey,
            JSEncKey:this.acpt.sKey.JSEncKey,
            SNwkSIntKey:this.acpt.sKey.SNwkSIntKey,
            FNwkSIntKey:this.acpt.sKey.FNwkSIntKey,
            NwkSEncKey: this.acpt.sKey.NwkSEncKey,
            AppSKey: this.acpt.sKey.AppSKey,
          };
        } else if (this.JoinReqType === consts.JoinType) {
          deviceInfoUpd = {
            DevAddr: DevAddr,
            DevNonce: this.DevNonce,
            JoinNonce: this.JoinNonce,
            JSIntKey:this.acpt.sKey.JSIntKey,
            JSEncKey:this.acpt.sKey.JSEncKey,
            SNwkSIntKey:this.acpt.sKey.SNwkSIntKey,
            FNwkSIntKey:this.acpt.sKey.FNwkSIntKey,
            NwkSEncKey: this.acpt.sKey.NwkSEncKey,
            AppSKey: this.acpt.sKey.AppSKey,
          };
        } else {
          deviceInfoUpd = {
            DevAddr: DevAddr,
            RJcount0: this.DevNonce,
            JoinNonce: this.JoinNonce,
            JSIntKey:this.acpt.sKey.JSIntKey,
            JSEncKey:this.acpt.sKey.JSEncKey,
            SNwkSIntKey:this.acpt.sKey.SNwkSIntKey,
            FNwkSIntKey:this.acpt.sKey.FNwkSIntKey,
            NwkSEncKey: this.acpt.sKey.NwkSEncKey,
            AppSKey: this.acpt.sKey.AppSKey,
          };
        }
      } else {
        deviceInfoUpd = {
          DevAddr: DevAddr,
          DevNonce: this.DevNonce,
          AppNonce: this.JoinNonce,
          SNwkSIntKey:this.acpt.sKey.SNwkSIntKey,
          FNwkSIntKey:this.acpt.sKey.FNwkSIntKey,
          NwkSEncKey: this.acpt.sKey.NwkSEncKey,
          AppSKey: this.acpt.sKey.AppSKey,
        };
      }
      delete this.acpt['sKey'];

      const logMessage = {
        DevAddr: DevAddr,
        DevEUI: joinReq.DevEUI,
        JoinEUI: this.JoinEUI,
      };
      this.DevAddr = DevAddr;
      this.log.info(logMessage);
      this.defaultConf.DevAddr = DevAddr;
      this.defaultConf.RX1DRoffset = RX1DRoffset;

      return this.DeviceInfo.updateItem(appKeyQueryOpt, deviceInfoUpd)
      .then(() => initDeviceConf(this.defaultConf));
    };

    const returnAcptMsg = () => {
      const acptPHY = JoinHandler.joinAcptPHYPackager(this.acpt);
      return bluebird.resolve(acptPHY);
    };

    return this.readDevice(appKeyQueryOpt)
      .then(rejoinProcedure)
      .then(updateDevInfo)
      .then(returnAcptMsg)
  }

}

//Class methods or Static methods

JoinHandler.genDevAddr = (JoinEUI, DevEUI, NwkID) => {
  const hash = crypto.createHash(consts.HASH_METHOD);
  const eui = Buffer.concat([JoinEUI, DevEUI], consts.JOINEUI_LEN + consts.DEVEUI_LEN);
  const devAddr = hash.update(eui).digest().slice(0, consts.DEVADDR_LEN - 1);
  return Buffer.concat([NwkID, devAddr]);
};

JoinHandler.genSKey = (Key, nonce, ProtocolVersion, type) => {
  let sessionBuf = Buffer.alloc(consts.BLOCK_LEN);
  //type = type || 'NWK';
  if(ProtocolVersion =='1.1'){
    if (type === 'JSINT') {
      sessionBuf[0] = 0x06;
    } else if (type ==='JSENC'){
      sessionBuf[0] = 0x05;
    } else if (type ==='SNWKSINT'){
      sessionBuf[0] = 0x03;
    } else if (type ==='FNWKSINT'){
      sessionBuf[0] = 0x01;
    } else if (type ==='NWKSENC'){
      sessionBuf[0] = 0x04;
    } else if (type === 'APP') {
      sessionBuf[0] = 0x02;
    }
  }
  else{
    if(type === 'APP'){
      sessionBuf[0] = 0x02;
    }else{
      sessionBuf[0] = 0x01;
    }
  }
  const joinnonce = reverse(nonce.JoinNonce);
  const joineui = reverse(nonce.JoinEUI);
  const devnonce = reverse(nonce.DevNonce);
  const deveui = reverse(nonce.DevEUI);
  if(ProtocolVersion =='1.1'){
    if((type === 'JSINT')||(type === 'JSENC')){
      deveui.copy(sessionBuf, consts.SK_DEVEUI_OFFSET);
    }
    else{
      joinnonce.copy(sessionBuf, consts.SK_JOINNONCE_OFFSET);
      joineui.copy(sessionBuf, consts.SK_JOINEUI_OFFSET);
      devnonce.copy(sessionBuf, consts.SK_DEVNONCE_OFFSET);
    }
  }
  else{
    joinnonce.copy(sessionBuf, consts.SK_JOINNONCE_OFFSET);
    netid.copy(sessionBuf, consts.SK_NETID_OFFSET);
    devnonce.copy(sessionBuf, consts.SK_DEVNONCE_102_OFFSET);
  }
  
  const iv = '';//crypto.randomBytes(consts.IV_LEN);
  const cipher = crypto.createCipheriv(consts.ENCRYPTION_ALGO, Key, iv);
  const sessionKey = cipher.update(sessionBuf, 'binary');
  return sessionKey;
};

JoinHandler.joinAcptPHYPackager = (joinAcpt) => {
  const MHDR = {
    MType: consts.JOIN_ACCEPT,
    Major: consts.MAJOR_DEFAULT,
  };
  const micPayloadJSON = Object.assign({}, joinAcpt);
  micPayloadJSON.MHDR = MHDR;
  return {
    MHDR: MHDR,
    MACPayload: joinAcpt,
    DevAddr: joinAcpt.DevAddr,
  };
};

module.exports = JoinHandler;

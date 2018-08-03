#!/bin/node

const config = require('./config');
const loraLib = require('./lib/lora-lib');
const {ERROR, Log, Models, MQClient, dbClient} = loraLib;

const JoinHandler = require('./lib/joinHandler');
const bluebird = require('bluebird');
const util = require('util');

const db = {
  MySQLClient: dbClient.createSequelizeClient(config.database.mysql),
};

//Initialization
const modelIns = {
  MySQLModel: {},
};

for (let model in Models.MySQLModels) {
  modelIns.MySQLModel[model] = new Models.MySQLModels[model](db.MySQLClient);
}

const log = new Log(config.log);
const mqClient = new MQClient(config.mqClient, log);
const joinHandler = new JoinHandler(modelIns, config, log);
const handleMessage = () => {
  mqClient.message((message) => {
    const data = message.value.rxpk.data;
    joinHandler.handler(message.value.rxpk)
    .then((acptPHYPayload) => {
      monitor.addMonitorVarCount('validJoinReq', 1);
      monitor.addMonitorVarCount('joinRes', 1);
      message.value.rxpk.data = acptPHYPayload;
      return mqClient.publish(config.mqClient.producer.joinServerTopic, message.value);
    })
    .catch((error) => {
      log.error(error.stack);
      monitor.addMonitorVarCount('invalidJoinReq', 1);
      if (error instanceof ERROR.MICDismatchError) {
        log.error(error.message);
      } else if (error instanceof ERROR.DeviceNotExistError) {
        log.error(error.message);
      } else if (error instanceof ERROR.InvalidMessageError) {
        log.error(error.message);
      } else {
        log.error(error.stack);
      }

    });
  });
  return bluebird.resolve(null);
};

const logBasicMessage = () => {
  log.info(`LoRa join server starts to listen topic: ${config.mqClient.consumerGroup.topics}`);
  return bluebird.resolve();
};

// Run
mqClient.connect().then(logBasicMessage)
.then(handleMessage)
.catch((error) => {
  return log.error(error.message);
});

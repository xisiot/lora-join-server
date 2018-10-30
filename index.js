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
const mqClient = new MQClient(config.mqClient_js, log);
const handleMessage = () => {
  mqClient.message((message) => {
    const joinHandler = new JoinHandler(modelIns, config, log);
    const data = message.value.rxpk.data;
    joinHandler.handler(message.value.rxpk)
    .then((acptPHYPayload) => {
      message.value.rxpk.data = acptPHYPayload;
      return mqClient.publish(config.mqClient_js.producer.joinServerTopic, message.value);
    })
    .catch((error) => {
      log.error(error.stack);
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
  log.info(`LoRa join server starts to listen topic: ${config.mqClient_js.consumerGroup.topics}`);
  return bluebird.resolve();
};

// Run
mqClient.connect().then(logBasicMessage)
.then(handleMessage)
.catch((error) => {
  return log.error(error.message);
});

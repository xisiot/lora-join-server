'use strict';

const chai = require('chai');
chai.use(require('chai-json-schema-ajv'));
const expect = chai.expect;
const assert = chai.assert;
const mocha = require('mocha');
const crypto = require('crypto');
const consts = require('../../../lib/constants');
const config = require('../../../config');
const mochaConfig = config.mocha;
const Model = require('../../../models');
const databaseConfig = config.database.mysql;
const sequelize = require('../../../lib/dbClient').createSequelizeClient(databaseConfig);

const appInfo = {
  AppEUI: crypto.randomBytes(consts.APPEUI_LEN),
  userID: 'testUser',
  name: 'test',
};

const deviceInfo = {
  AppKey: crypto.randomBytes(consts.APPKEY_LEN),
  DevEUI: crypto.randomBytes(consts.DEVEUI_LEN),
  AppEUI: appInfo.AppEUI,
};

describe('Test ForeignKey between AppInfo with DeviceInfo: AppEUI', function () {
  let AppInfo;
  let DeviceInfo;
  before('Get connection with MySQL', function () {
    DeviceInfo = new Model.MySQLModels.DeviceInfo(sequelize);
    AppInfo = new Model.MySQLModels.AppInfo(sequelize);
  });

  this.timeout(mochaConfig.timeout);
  it('AppInfo createItem', function (done) {
    const queryApp = {
      userID: appInfo.userID,
    };
    const queryDev = {
      AppKey: deviceInfo.AppKey,
    };

    AppInfo
      .createItem(appInfo)
      .then(function () {
        return DeviceInfo.createItem(deviceInfo);
      })
      .then(function () {
        return AppInfo.removeItem(queryApp);
      })
      .then(function (res) {
        return DeviceInfo.readItem(queryDev);
      })
      .then(function (res) {
        expect(res).to.be.empty;
        done();
      })
      .catch(function (err) {
        AppInfo.removeItem(queryApp);
        done(err);
      });
  });

  after('Close Conenction with MySQL', function (done) {
    sequelize.close();
    done();
  });
});

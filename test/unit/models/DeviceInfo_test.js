'use strict';

const chai = require('chai');
chai.use(require('chai-json-schema-ajv'));
const expect = chai.expect;
const assert = chai.assert;
const mocha = require('mocha');
const crypto = require('crypto');
const consts = require('../../../lib/constants');
const config = require('../../../config');
const Model = require('../../../models');
const sequelize = require('../../../lib/dbClient').createSequelizeClient(config.database.mysql);
const mochaConfig = config.mocha;

const testAppInfo = {
  AppEUI: crypto.randomBytes(consts.APPEUI_LEN),
  userID: 'testUser',
};

const rmAppInfoQuery = {
  AppEUI: testAppInfo.AppEUI,
};

const deviceInfo = {
  AppKey: crypto.randomBytes(consts.APPKEY_LEN),
  DevEUI: crypto.randomBytes(consts.DEVEUI_LEN),
  AppEUI: testAppInfo.AppEUI,
};

const updDevEUI = crypto.randomBytes(consts.DEVEUI_LEN);

describe('Test DeviceInfo model', function () {
  let DeviceInfo;
  let AppInfo;
  before('Get connection with MySQL', function (done) {
    DeviceInfo = new Model.MySQLModels.DeviceInfo(sequelize);
    AppInfo = new Model.MySQLModels.AppInfo(sequelize);
    AppInfo
      .createItem(testAppInfo)
      .then(function () {
        done();
      })
      .catch(function (err) {
        AppInfo.removeItem(rmAppInfoQuery);
        done(err);
      });
  });

  this.timeout(mochaConfig.timeout);
  it('DeviceInfo createItem', function (done) {
    const query = {
      AppEUI: testAppInfo.AppEUI,
    };

    const attributes = {
      DevEUI: updDevEUI,
    };

    DeviceInfo
      .createItem(deviceInfo)
      .then(function () {
        return DeviceInfo.updateItem(query, attributes);
      })
      .then(function () {
        return DeviceInfo.readItem(query);
      })
      .then(function (res) {
        expect(res).not.to.be.empty;
        expect(res.DevEUI).to.deep.equal(updDevEUI);
        return DeviceInfo.removeItem(query);
      })
      .then(function () {
        done();
      })
      .catch(function (err) {
        DeviceInfo.removeItem(query);
        done(err);
      });
  });

  after('Close Conenction with MySQL', function (done) {
    AppInfo
      .removeItem(rmAppInfoQuery)
      .then(function () {
        sequelize.close();
        done();
      });
  });
});

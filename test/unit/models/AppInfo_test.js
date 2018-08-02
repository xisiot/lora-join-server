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
const databaseConfig = config.database.mysql;
const Model = require('../../../models');
const sequelize = require('../../../lib/dbClient').createSequelizeClient(databaseConfig);

const appInfo = {
  AppEUI: crypto.randomBytes(consts.APPEUI_LEN),
  userID: 'testUser',
  name: 'test',
};

describe('Test AppInfo model', function () {
  let AppInfo;
  before('Get connection with MySQL', function () {
    AppInfo = new Model.MySQLModels.AppInfo(sequelize);
  });

  this.timeout(mochaConfig.timeout);
  it('AppInfo createItem', function (done) {
    const query = {
      AppEUI: appInfo.AppEUI,
    };

    const attributes = {
      name: 'test success',
    };

    AppInfo
      .createItem(appInfo)
      .then(function () {
        return AppInfo.updateItem(query, attributes);
      })
      .then(function () {
        return AppInfo.readItem(query);
      })
      .then(function (res) {
        expect(res).not.to.be.empty;
        expect(res.userID).to.deep.equal(appInfo.userID);
        expect(res.name).to.deep.equal(attributes.name);
        return AppInfo.removeItem(query);
      })
      .then(function () {
        done();
      })
      .catch(function (err) {
        AppInfo.removeItem(query);
        done(err);
      });
  });

  after('Close Conenction with MySQL', function (done) {
    sequelize.close();
    done();
  });
});

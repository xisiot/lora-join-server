const Sequelize = require('sequelize');

const createSequelizeClient = function (config) {
  return new Sequelize(
    config.database,
    config.username,
    config.password,
    config
  );
};

module.exports = {
  createSequelizeClient,
};

'use strict'

var CONFIGURATIONS = {
  mysql: {
    dialect: 'mysql',
    username: 'root'
  },
  postgres: {
    dialect: 'postgres',
    username: 'postgres'
  },
  sqlite: {
    dialect: 'sqlite',
    storage: ':memory:'
  }
}

module.exports = function (database) {
  var config = CONFIGURATIONS[process.env.SEQUELIZE_DIALECT] || CONFIGURATIONS.mysql
  config.database = database
  return config
}

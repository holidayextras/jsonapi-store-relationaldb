'use strict'
var async = require('async')
var config = require('../lib/config.js')
var JsonapiStoreRelationalDb = require('..')

var instances = [ ]

var DATABASE = 'jsonapi-relationaldb-test'

// Replace the MemoryStore default handler with our own version
require('jsonapi-server/lib/MemoryHandler')
module.children[3].exports = function () {
  var dbStore = new JsonapiStoreRelationalDb(config(DATABASE))
  // Keep the handler around for after the test rig is live
  instances.push(dbStore)
  return dbStore
}

// Load the jsonapi-server test suite
var fs = require('fs')
var path = require('path')
var base = path.join(__dirname, '../node_modules/jsonapi-server/test')
fs.readdirSync(base).forEach(function (filename) {
  var filePath = path.join(base, filename)
  if (!fs.lstatSync(filePath).isDirectory()) {
    require(filePath)
  }
})

// MySQL doesn't differentiate between undefined and null.
// Tweak the created field to allow null fields to pass Joi validation.
var articles = require('jsonapi-server')._resources.articles
articles.attributes.created = articles.attributes.created.allow(null)
articles.onCreate.created = articles.onCreate.created.allow(null)

// Before starting the test suite, load all example resouces, aka
// the test fixtures, into the databases
before(function (done) {
  async.each(instances, function (dbStore, callback) {
    dbStore.populate(callback)
  }, done)
})

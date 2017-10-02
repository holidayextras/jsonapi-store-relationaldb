var DataTypes = require('sequelize').DataTypes

exports.joiSchemaToSequelizeModel = function (resourceName, joiSchema) {
  var model = {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    type: {
      type: DataTypes.VIRTUAL, // We do not actually save this to DB, but API needs this
      set: function (val) {
        this.setDataValue('type', val)
      },
      get: function () {
        return resourceName
      }
    },
    meta: {
      type: DataTypes.JSONB,
      get: function () {
        var data = this.getDataValue('meta')
        if (!data) return undefined
        return data
      },
      set: function (val) {
        return this.setDataValue('meta', val)
      }
    }
  }

  Object.keys(joiSchema).forEach(function (attributeName) {
    var attribute = joiSchema[attributeName]
    if (attribute._type === 'string') model[attributeName] = { type: DataTypes.TEXT, allowNull: true }
    if (attribute._type === 'date') model[attributeName] = { type: DataTypes.DATE, allowNull: true }
    if (attribute._type === 'number') {
      if (typeof attribute._flags.precision !== 'undefined') {
        model[attributeName] = { type: DataTypes.NUMERIC(32, attribute._flags.precision), allowNull: true }
      } else {
        model[attributeName] = { type: DataTypes.NUMERIC, allowNull: true }
      }
    }
    if (attribute._type === 'boolean') model[attributeName] = { type: DataTypes.BOOLEAN, allowNull: true }
    if (attribute._type === 'array') {
      // PostgreSQL has proper array support, so lets use that
      switch (attribute._inner.items[0]._type) {
        case 'string': model[attributeName] = {type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true}; break
        case 'number': model[attributeName] = {type: DataTypes.ARRAY(DataTypes.NUMERIC), allowNull: true}; break
        case 'boolean': model[attributeName] = {type: DataTypes.ARRAY(DataTypes.BOOLEAN), allowNull: true}; break
      }
      model[attributeName].get = function () {
        return this.getDataValue(attributeName) || []
      }
      model[attributeName].set = function (val) {
        this.setDataValue(attributeName, val || [])
      }
    }
  })

  return model
}

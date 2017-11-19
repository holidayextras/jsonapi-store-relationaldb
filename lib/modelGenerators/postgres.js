const DataTypes = require('sequelize').DataTypes
const Default = require('./default')

module.exports = class extends Default {
  constructor (resourceName, joiSchema) {
    super(resourceName, joiSchema)
    this.meta = {
      type: DataTypes.JSONB,
      get: function () {
        const data = this.getDataValue('meta')
        if (!data) return undefined
        return data
      },
      set: function (val) {
        return this.setDataValue('meta', val)
      }
    }

    for (let attributeName of Object.keys(joiSchema)) {
      const attribute = joiSchema[attributeName]
      if (attribute._type === 'number') {
        if (typeof attribute._flags.precision !== 'undefined') {
          this[attributeName] = {
            type: DataTypes.NUMERIC(32, attribute._flags.precision),
            allowNull: true
          }
        } else {
          this[attributeName] = {
            type: DataTypes.NUMERIC,
            allowNull: true
          }
        }
      }
      if (attribute._type === 'array') {
        // PostgreSQL has proper array support, so lets use that
        switch (attribute._inner.items[0]._type) {
          case 'string':
            this[attributeName] = {
              type: DataTypes.ARRAY(DataTypes.STRING),
              allowNull: true
            }
            break
          case 'number':
            this[attributeName] = {
              type: DataTypes.ARRAY(DataTypes.NUMERIC),
              allowNull: true
            }
            break
          case 'boolean':
            this[attributeName] = {
              type: DataTypes.ARRAY(DataTypes.BOOLEAN),
              allowNull: true
            }
            break
        }
        this[attributeName].get = function () {
          return this.getDataValue(attributeName) || []
        }
        this[attributeName].set = function (val) {
          this.setDataValue(attributeName, val || [])
        }
      }
    }
  }
}

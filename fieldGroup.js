import {TABLE_TYPES, NEW_ROW_PREFIX} from "./createInsertOrUpdateFunction";
import {CHANGE_TYPES} from "./handler";
import {deleteFromDotNotation, getFromDotNotation} from "./utils/objectUtils";
import {murmurhash3} from "./utils/murmur";

export class FieldGroup
{
    tableData = null;
    handler = null;

    manyToOneDataKey = null

    manyToOneFieldGroup = null;
    oneToManyFieldGroups = {};
    manyToNGroups = {};
    excludedKeys = [];

    rawOriginalData = null;
    rawNewData = null;

    dbActionFunc = null;

    _children = []

    results = {};

    /**
     * @param tableData {object}
     * @param dbActionFunc {function}
     */
    constructor(tableData, dbActionFunc) {
        this.tableData = tableData
        this.dbActionFunc = dbActionFunc
        this.results = {}
    }

    /**
     * @param fieldGroup {FieldGroup}
     * @param dataKey {string}
     * @param relationalKey {?string}
     */
    addOneToNFieldGroup(fieldGroup, dataKey, relationalKey = null) {
        fieldGroup.handler = this.handler
        fieldGroup.manyToOneFieldGroup = this;
        fieldGroup.manyToOneDataKey = dataKey;
        this.excludedKeys.push(dataKey);
        this._children.push(fieldGroup);
        if (relationalKey) {
            this.oneToManyFieldGroups[relationalKey] = fieldGroup;
        }
    }

    /**
     * @param fieldGroup {FieldGroup}
     * @param relationalKey {string}
     * @param dataKey {?string}
     */
    addManyToOneFieldGroup(fieldGroup, relationalKey, dataKey= null) {
        fieldGroup.handler = this.handler;
        this.manyToNGroups[relationalKey] = fieldGroup;
        this._children.push(fieldGroup);
        if (dataKey) {
            this.siblingDataKey = dataKey;
        }
    }

    /**
     * @returns {string}
     */
    get changeType() {
        const originalData = Array.isArray(this.originalData) ? this.originalData : Object.keys(this.originalData);
        if (originalData.length) {
            return CHANGE_TYPES.update;
        }
        return CHANGE_TYPES.insert;
    }

    /**
     * @returns {object}
     */
    _parseData(data, isNewData = false) {
        let parsedData = {};
        if (data) {
            parsedData = data;
        } else if (this.manyToOneFieldGroup) {
            parsedData = getFromDotNotation(this.manyToOneFieldGroup[isNewData ? 'rawNewData' : 'rawOriginalData'] || {}, this.manyToOneDataKey.split('.')) || {};
        }
        if (this.tableData.type === TABLE_TYPES.join) {
            parsedData = this.setRelationIds(parsedData, this.tableData.m2m || {}, this.manyToNGroups, false) || {};
        } else {
            if (Object.keys(this.manyToNGroups).length) {
                parsedData = this.setRelationIds(parsedData, this.tableData.m2o || {}, this.manyToNGroups) || {};
            }
            if (Object.keys(this.oneToManyFieldGroups).length) {
                parsedData = this.setRelationIds(parsedData, this.tableData.m2o || {}, this.oneToManyFieldGroups) || {};
            }
            const excludeKeysFunction = (item) => Object.keys(item).filter(key => this.excludedKeys.indexOf(key) === -1).reduce((obj, key) => { obj[key] = item[key]; return obj; }, {}) || {}
            if (Array.isArray(parsedData)) {
                parsedData = parsedData.map(excludeKeysFunction);
            } else {
                parsedData = excludeKeysFunction(parsedData);
            }
        }
        return parsedData;
    }

    /**
     * @param originalData {object}
     */
    set originalData(originalData) {
        this.rawOriginalData = originalData;
    }

    /**
     * @returns {object}
     */
    get originalData() {
        return this._parseData(this.rawOriginalData)
    }

    /**
     * @param newData {object}
     */
    set newData(newData) {
        this.rawNewData = FieldGroup._newId(newData);
    }

    /**
     * @returns {object}
     */
    get newData() {
        return FieldGroup._newId(this._parseData(this.rawNewData, true));
    }

    static _newId(data = null) {
        if (Array.isArray(data)) {
            return data.map(FieldGroup._newId);
        }
        const newId = NEW_ROW_PREFIX + murmurhash3(String(Math.random()), 1);
        if (!data) {
            return newId;
        }
        if (Object.keys(data).length) {
            if (!data.id) {
                data.id = newId;
            }
        }
        return data;
    }

    /**
     * @param data {object}
     * @param relations {object}
     * @param fieldGroupMappings {object}
     * @param isChild {boolean}
     * @returns {object}
     */
    setRelationIds(data, relations, fieldGroupMappings, isChild = true) {
        if (Array.isArray(data)) {
            return data.map(item => this.setRelationIds(item, relations, fieldGroupMappings, isChild));
        }
        for (const columnName of Object.keys(relations)) {
            if (isChild) {
                data[columnName] = getFromDotNotation(data, fieldGroupMappings[columnName]?.manyToOneDataKey?.split('.'))?.id || data[columnName];
                deleteFromDotNotation(data, fieldGroupMappings[columnName]?.manyToOneDataKey?.split('.'));
            }
            if(!data[columnName] || (new RegExp(`^${NEW_ROW_PREFIX}`)).test(data[columnName])) {
                let relationId;
                relationId = (fieldGroupMappings[columnName]?.results?.inserts || {})[data[columnName]]?.id;
                if (!relationId && !data[columnName]) {
                    relationId = Object.values((fieldGroupMappings[columnName]?.results?.inserts || {}))[0]?.id;
                }
                if (!relationId && Array.isArray(fieldGroupMappings[columnName]?.originalData)) {
                    relationId = fieldGroupMappings[columnName].originalData.find(item => item.id === data[columnName])?.id;
                }
                if (!relationId) {
                    relationId = fieldGroupMappings[columnName]?.newData?.id || fieldGroupMappings[columnName]?.originalData?.id;
                }
                if (relationId) {
                    data[columnName] = relationId;
                }
            }
        }
        return data;
    }

    postSubmit = async () => {
        if (!this.results?.errors?.length) {
            let isArray = false;
            if (Array.isArray(this.originalData)) {
                isArray = true;
            }
            for (const [id, data] of Object.entries(Object.assign(this.results?.updates || {}, this.results?.inserts || {}))) {
                Object.values(this.oneToManyFieldGroups).forEach(childFieldGroup => {
                   if (!childFieldGroup.rawOriginalData) {
                       childFieldGroup.rawOriginalData = childFieldGroup.originalData;
                   }
                });
                if (isArray) {
                    this.originalData = this.originalData.filter(item => item.id !== id).concat([data]);
                } else {
                    this.originalData = Object.assign({}, this.rawOriginalData || {}, data || {});
                }
            }
        }
    }
}

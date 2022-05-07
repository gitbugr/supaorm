import {deleteFromDotNotation, getFromDotNotation} from "./utils/objectUtils";
import {murmurhash3} from "./utils/murmur";

export const TABLE_TYPES = {
    entity: 'ENTITY',
    join: 'JOIN',
}

export const CHANGE_TYPES = {
    insert: 'INSERT',
    update: 'UPDATE',
}

// noinspection JSUnresolvedVariable
export class Handler
{
    #fieldGroups = {};

    /**
     * @param fieldGroup {FieldGroup}
     */
    addFieldGroup(fieldGroup) {
        fieldGroup.handler = this;
        this.#fieldGroups[fieldGroup.tableData.name] = fieldGroup;
    }

    /**
     * @param tableName {string}
     * @returns {FieldGroup}
     */
    getFieldGroup(tableName) {
        return this.#fieldGroups[tableName];
    }

    /**
     * @returns {FieldGroup[]}
     */
    _getAllFieldGroupsIncludingChildren() {
        let allFieldGroups = [];
        Object.values(this.#fieldGroups).forEach(fieldGroup => {
            allFieldGroups = [...allFieldGroups, fieldGroup, ...fieldGroup._children];
        });
        return [...new Set(allFieldGroups)];
    }

    /**
     * @param fieldGroup {FieldGroup}
     * @returns {(string)[]}
     */
    static _getRelatedTablesForFieldGroup(fieldGroup) {
        return [...Object.values(fieldGroup.tableData.m2o || {}), ...Object.values(fieldGroup.tableData.m2m || {})];
    }

    async submit() {
        // we want tables that depend on other tables to be run first
        const tablesAdded = [];
        const allFieldGroups = [];
        this._getAllFieldGroupsIncludingChildren().forEach(fieldGroup => {
            if (FormHandler._getRelatedTablesForFieldGroup(fieldGroup).every(tableName => tablesAdded.indexOf(tableName) === -1)) {
                allFieldGroups.unshift(fieldGroup);
            } else {
                allFieldGroups.push(fieldGroup);
            }
            tablesAdded.push(fieldGroup.tableData.name);
        });
        for (const fieldGroup of allFieldGroups) {
            await (fieldGroup.dbActionFunc.bind(fieldGroup))();
            await (fieldGroup.postSubmit)(fieldGroup);
        }
        allFieldGroups.forEach(fieldGroup => fieldGroup.newData = null);
    }
}

export const groomData = async (form, originalData = {}, specialKeys = {}, removeKeys = []) => {
    const fields = {
        ...originalData,
        ...form.getFieldsValue(),
    }

    Object.entries(specialKeys).forEach(([key, val]) => {
        fields[key] = val(fields, key);
    });

    removeKeys.forEach((key) => {
        delete fields[key];
    });

    // explode dot-concatenated keys
    let explodedFields = {};
    const dotConcatenatedKeys = Object.keys(fields).filter(key => key.indexOf('.') !== -1);
    const setToExplodedFields = (value, keyParts, existingObj) => {
        if (keyParts.length > 1) {
            return { ...existingObj, [keyParts[0]]: setToExplodedFields(value, keyParts.slice(1), explodedFields[keyParts[0]] || {}) };
        } else {
            return { ...existingObj, [keyParts[0]]: value };
        }
    }
    dotConcatenatedKeys.map(key => [key, key.split('.')]).forEach(([key, explodedKeys]) => {
        explodedFields[explodedKeys[0]] = setToExplodedFields(fields[key], explodedKeys.slice(1), explodedFields[explodedKeys[0]] || fields[explodedKeys[0]] || {});
        delete fields[key];
    });

    return {
        ...fields,
        ...explodedFields,
    };
}

// noinspection JSUnusedGlobalSymbols
export const mapNameAndIdToSelectValues = (values) => values.map(value => ({value: value.id, label: value.name}));

export const NEW_ROW_PREFIX = 'new_';

/**
 * Generalised method for inserting and updating entities from the handler, may not be suitable for all use-cases
 * @param supabase {object}
 * @param table {object}
 * @param destructive {boolean}
 * @returns {function}
 */
export const createDbActionFunc = (supabase, table, destructive = false) => {
    // @TODO: use transactions once implemented - https://github.com/supabase/postgrest-js/issues/219
    const insertFunction = async (data) => await supabase.from(table.name).insert(data);
    const updateFunction = async (data, id) => await supabase.from(table.name).update(data).match({id});
    const deleteFunction = async (ids) => await supabase.from(table.name).delete().in('id', ids);
    return async function () {
        this.results = {
            'inserts': {},
            'updates': {},
            'deletes': [],
            'errors': [],
        };

        const originalData = Array.isArray(this.originalData) ? this.originalData : [this.originalData];
        const newData = Array.isArray(this.newData) ? this.newData : [this.newData];
        const updateData = [];
        const deleteIds = originalData.map(item => item.id).filter(id => newData.map(item => item.id).indexOf(id) === -1 && id);
        if (this.changeType === CHANGE_TYPES.update) {
            newData.forEach((newItem) => {
                const originalItem = originalData.find(originalItem => newItem.id === originalItem.id);
                const changes = {};
                if (originalItem) {
                    for (const [key, value] of Object.entries(originalItem)) {
                        if (newItem[key] && newItem[key] !== value) {
                            changes[key] = newItem[key];
                        }
                    }
                    if (Object.keys(changes).length) {
                        updateData.push([newItem.id, changes]);
                    }
                }
            });
        }
        const insertData = newData.filter(item => (new RegExp(`^${NEW_ROW_PREFIX}`)).test(String(item.id))).map(item => {
            const newItem = Object.assign({}, item);
            delete newItem.id;
            return [item.id, newItem];
        });

        const doDbFunc = async (resultKey, func, itemKey, item, ...extraArgs) => {
            const result = await func(item, ...extraArgs);
            if (result.data?.length) {
                this.results[resultKey][itemKey] = result.data[0];
            } else {
                this.results.errors.push(result);
            }
        }

        for (const item of insertData) {
            await doDbFunc('inserts', insertFunction, item[0], item[1]);
        }
        for (const [id, item] of updateData) {
            await doDbFunc('updates', updateFunction, item.id, item, id);
        }
        if (destructive && deleteIds) {
            if (!(await deleteFunction(deleteIds))) {
                this.results.errors.push({message: `could not delete ids: ${deleteIds.join(', ')}`});
            }
        }
    }
}

// noinspection JSUnusedLocalSymbols
export const supabaseDriver = (supabase) => (tableStructure) => createDbActionFunc(supabase, tableStructure);

const getSingularFromPluralString = (pluralString) => {
    if (pluralString.slice(pluralString.length - 3) === 'ies') {
        return pluralString.slice(0, pluralString.length - 1);
    }
    if (pluralString.slice(pluralString.length - 2) === 'es') {
        return pluralString.slice(0, pluralString.length - 2);
    }
    if (pluralString[pluralString.length - 1] === 's') {
        return pluralString.slice(0, pluralString.length - 1);
    }
    return pluralString;
};

const getPluralFromIdString = (idString) => {
    if (idString.slice(idString.length - 3) === '_id') {
        const noIdSuffix = idString.slice(0, idString.length - 3);
        return noIdSuffix[noIdSuffix.length - 1] === 's' ? noIdSuffix + 'es' : noIdSuffix + 's';
    }
    return idString;
};

const makeNestedFieldGroup = (tableKey, tableMappings, driver, exclude = null) => {
    const tableStructure = tableMappings[tableKey];
    const tableKeyIdSuffix = `${getSingularFromPluralString(tableStructure.name)}_id`
    const fieldGroup = new FieldGroup(tableStructure, driver(tableStructure));
    let childFieldGroup;
    // noinspection JSUnresolvedVariable
    if (tableStructure.m2o) {
        for (const [key, value] in Object.entries(tableStructure.m2o)) {
            if (exclude === value) {
                continue;
            }
            childFieldGroup = makeNestedFieldGroup(value, tableMappings, driver, tableStructure.name);
            childFieldGroup.addOneToNFieldGroup(fieldGroup, tableKeyIdSuffix);
            fieldGroup.addManyToOneFieldGroup(childFieldGroup, getPluralFromIdString(key));
        }
    }
    // noinspection JSUnresolvedVariable
    if (tableStructure.m2m) {
        for (const [key, value] in Object.entries(tableStructure.m2m)) {
            if (exclude === value) {
                continue;
            }
            childFieldGroup = makeNestedFieldGroup(value, tableMappings, driver, tableStructure.name);
            fieldGroup.addOneToNFieldGroup(childFieldGroup, getPluralFromIdString(key));
        }
    }
    return fieldGroup;
}

export const makeHandler = (tableKey, tableMappings, driver) => {
    const handler = new Handler();
    handler.addFieldGroup(makeNestedFieldGroup(tableKey, tableMappings, driver));
    return handler;
}

// noinspection JSUnresolvedVariable
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
            // noinspection JSUnusedGlobalSymbols
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

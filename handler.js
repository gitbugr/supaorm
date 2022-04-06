export const CHANGE_TYPES = {
    insert: 'INSERT',
    update: 'UPDATE',
}
// noinspection JSUnresolvedVariable
export class Handler
{
    #fieldGroups = {};
    #supabase = {};

    constructor(supabase) {
        this.#supaase = supabase;
    }

    /**
     * @param fieldGroup {FieldGroup}
     */
    addFieldGroup(fieldGroup) {
        fieldGroup.formHandler = this;
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

export const mapNameAndIdToSelectValues = (values) => values.map(value => ({value: value.id, label: value.name}));


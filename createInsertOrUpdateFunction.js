import {CHANGE_TYPES} from "./handler";

export const TABLE_TYPES = {
    entity: 'ENTITY',
    join: 'JOIN',
}

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

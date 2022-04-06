/**
 * @param availability
 * @returns {string}
 */
import moment from "moment";

export function availabilityToString(availability, day) {
    const from = availabilityToMoment(availability, day, 'from');
    const to = availabilityToMoment(availability, day, 'to');
    if (from && to) {
        return `${from.format('HH:mm')} - ${to.format('HH:mm')}`;
    }
    return '';
}

export function availabilityToMoment(availability, day, toFrom='to') {
    if (Object.keys(availability || {}).length && availability[`${day}_${toFrom}`]) {
        return moment(availability[`${day}_${toFrom}`], 'HH:mm:ssZZ');
    }
    return null
}

export function getFromDotNotation(obj, dotNotationAsArr) {
    if (!dotNotationAsArr) {
        return {};
    }
    if (dotNotationAsArr.length === 1) {
        return obj[dotNotationAsArr[0]] || {};
    }
    return getFromDotNotation(obj[dotNotationAsArr[0]] || {}, dotNotationAsArr.slice(1));
}

export function deleteFromDotNotation(obj, dotNotationAsArr) {
    if (!dotNotationAsArr) {
        return;
    }
    if (dotNotationAsArr.length === 1) {
        if (obj[dotNotationAsArr[0]]) {
            delete obj[dotNotationAsArr[0]];
        }
    } else {
        deleteFromDotNotation(obj[dotNotationAsArr[0]] || {}, dotNotationAsArr.slice(1));
    }
}

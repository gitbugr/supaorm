# SupaODM (pre-alpha)

An orm-like library for easier working with relational tables via supabase.

This makes using forms much nicer (more modular) than the spaghetti code than ensues, allowing you to nest your data like an ODM in line with relations.

Warning: This is more of a concept than a finished library. It works, but I think there could be a better approach

### Table Structure Setup

```js
import {TABLE_TYPES} from "../createInsertOrUpdateFunction";

export const TABLES = {
    profiles: { name: 'profiles', type: TABLE_TYPES.entity, get m2o() {
        return { address_id: TABLES.address.name };
    }},
    areas: { name: 'areas', type: TABLE_TYPES.entity },
    profileAreas: { name: 'profiles_areas', type: TABLE_TYPES.join, get m2m() {
        return { profile_id: TABLES.profiles.name, area_id: TABLES.areas.name }
    }},
    address: { name: 'addresses', type: TABLE_TYPES.entity },
    contacts: { name: 'contacts', type: TABLE_TYPES.entity, get m2o() {
        return { profile_id: TABLES.profiles.name };
    }},
}
```


### Example Component (React)


```js
import React, {useCallback, useEffect, useRef, useState} from "react";
import {Handler, groomData, mapNameAndIdToSelectValues} from "./formHandler";
import {Button, Card, Col, Form, Input, InputNumber, message, Popconfirm, Row, Space, Spin, Tooltip} from "antd";
import {TABLES} from "./tableData";
import {supabase} from './api';

const ProfileEditComponent = () => {
    /** create handler for profile */
    const profileHandler = useRef(new Handler(supabase));

    /** set up field groups */
    useEffect(() => {
        const profileFieldGroup = new FieldGroup(TABLES.profiles, createDbActionFunc(TABLES.profiles));
        // has O2O (one to one) relationship to address table
        profileFieldGroup.addOneToNFieldGroup(new FieldGroup(TABLES.address, createDbActionFunc(TABLES.address)), 'address', 'address_id');

        // Has O2M (one to many) relationship with contacts table
        const contactFieldGroup = new FieldGroup(TABLES.contacts, createDbActionFunc(TABLES.contacts))
        contactFieldGroup.addManyToOneFieldGroup(profileFieldGroup, 'profile_id')
        profileFieldGroup.addOneToNFieldGroup(contactFieldGroup, 'contacts');

        // Has M2M (many to many) relationship with areas table (via profile_areas table)
        const areasFieldGroup = new FieldGroup(TABLES.areas, createDbActionFunc(TABLES.areas));
        profileFieldGroup.addOneToNFieldGroup(areasFieldGroup, 'areas');

        const profileAreasFieldGroup = new FieldGroup(TABLES.profileAreas, createDbActionFunc(TABLES.profileAreas, true));
        profileAreasFieldGroup.addManyToOneFieldGroup(profileFieldGroup, 'profile_id');
        profileAreasFieldGroup.addManyToOneFieldGroup(areasFieldGroup, 'area_id');
        profileFieldGroup.addOneToNFieldGroup(profileAreasFieldGroup, 'profileAreas');

        // Add root level FieldGroup to Handler
        profileHandler.current.addFieldGroup(profileFieldGroup);
    }, []);

    /** handle form submit */
    const submitForm = async () => {
        // groom our data from form ready to be passed supabase crud operations
        const fields = await groomData(profileForm, profile, {
            // map selected areas to {id, profile_id, area_id} format
            profileAreas: (fields) => fields.areas?.map(area => ({
                id: profile?.profileAreas?.find(profileArea => profileArea.area_id === area && profileArea.profile_id === fields.id)?.id || FieldGroup._newId(),
                profile_id: fields.id,
                area_id: area
            })),
            // map areas from select to area
            areas: (fields) => fields.areas?.map(areaId => areas.find(area => area.id === areaId)),
        });

        // set data to FieldGroup
        const profileFieldGroup = profileHandler.current.getFieldGroup(TABLES.profiles.name);
        profileFieldGroup.newData = fields;
        // submit form
        await profileFormHandler.current.submit();

        // get id of new record
        const id = profileFieldGroup.results?.inserts[fields.id]?.id;
    }

    return (
        <Form form={profileForm}>
            {/* Profile Fields */}
            <Form.Item label="Name" name="name" initialValue={profile.name}><Input /></Form.Item>
            <Form.Item label="Phone" name="phone" initialValue={profile.phone}><Input /></Form.Item>
            {/* Address */}
            <Form.Item name="address.address_1" label="Line 1" initialValue={profile.address?.address_1}><Input /></Form.Item>
            <Form.Item name="address.address_2" label="Line 2" initialValue={profile.address?.address_2}><Input /></Form.Item>
            <Form.Item name="address.address_3" label="Line 3" initialValue={profile.address?.address_3}><Input /></Form.Item>
            <Form.Item name="address.city" label="City" initialValue={profile.address?.city}><Input /></Form.Item>
            <Form.Item name="address.postcode" label="Postcode" initialValue={profile.address?.postcode}><Input /></Form.Item>
            <Form.Item name="address.country" label="Country" initialValue={profile.address?.country}><Input /></Form.Item>
            {/* Areas */}
            <Form.Item  label="Areas"name="areas" initialValue={profile.areas?.map(area => Number(area.id)) || []}>
                {/* ... */}
            </Form.Item>
            {/* Contacts */}
            {/* ... */}
        </Form>
    );
}
```

Licence: MIT

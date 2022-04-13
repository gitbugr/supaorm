# SupaODM (pre-alpha)

An orm-like library for easier working with relational tables via supabase.

This makes using forms much easier, allowing you to nest your data like an ODM in line with relations.

Warning: This is more of a concept than a finished library.

## Table Structure Setup

```js
import {TABLE_TYPES} from "supaorm";

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


## Example Component (React)

```js
import React, {useCallback, useEffect, useRef, useState} from "react";
import {supabase} from './api';
import {makeHandler, groomData} from "supaorm";
import {TABLES} from "./tableData";
import {Form, Input} from "antd";

const ProfileEditComponent = () => {
    /** create handler for profile */
    const profileHandler = useRef(makeHandler('profiles', TABLES, supabase));

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

        // set data to nested FieldGroup
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

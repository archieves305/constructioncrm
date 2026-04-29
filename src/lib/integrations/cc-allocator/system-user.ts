// Deterministic id of the system user that integration writes attribute to.
// Inserted by the cc-allocator integration migration. The user is is_active
// = false (so login is blocked) and exists only as a User FK target on
// JobExpense.created_by_user_id.
export const CC_ALLOCATOR_SYSTEM_USER_ID = "sysuser-cc-allocator";

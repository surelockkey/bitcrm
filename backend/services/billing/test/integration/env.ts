// Runs before any test module is imported: repositories read the table name at import time.
process.env.BILLING_TABLE = 'BitCRM_Billing_Test';

# Bootstrap

One-time creation of the S3 bucket and DynamoDB lock table that hold every other Terraform state in this repo.

## Run once

```sh
cd backend/infra/bootstrap
terraform init
terraform apply
```

Outputs:
- `state_bucket_name` — copy into `backend/infra/backend.tf`
- `lock_table_name`   — copy into `backend/infra/backend.tf`
- `account_id`        — your AWS account ID

## Notes

- State for this directory stays local (`terraform.tfstate` here) — chicken-and-egg with the bucket it creates.
- `prevent_destroy = true` is set on both resources. To remove them you must remove that flag first, then `destroy`.
- Re-running `apply` on an unchanged config is a no-op.
- If you lose the local state, the resources still exist in AWS — `terraform import` them back rather than re-creating.

#!/usr/bin/env bash
# One-time seed of the first user: creates a Cognito user + matching DDB row
# so an admin can log in and start managing the system through the API.
#
# Run from the repo root with admin AWS credentials:
#   bash backend/scripts/seed-first-user.sh
#
# Or non-interactive:
#   SEED_EMAIL="you@example.com" SEED_PASSWORD="..." \
#     SEED_FIRST_NAME="Roman" SEED_LAST_NAME="Senyshyn" \
#     bash backend/scripts/seed-first-user.sh
#
# Idempotent: re-running on an existing email is a no-op.

set -euo pipefail

# ---------- locate infra refs ----------

INFRA_DIR="$(cd "$(dirname "$0")/../infra/dev" && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_REGION

echo ">>> Resolving Cognito user pool + DDB users table from Terraform / SSM..."

if ! USER_POOL_ID=$(terraform -chdir="$INFRA_DIR" output -raw user_pool_id 2>/dev/null); then
  echo "ERROR: terraform output user_pool_id failed. Run from a checkout where infra/dev state is accessible." >&2
  exit 1
fi

USERS_TABLE=$(aws ssm get-parameter \
  --name /bitcrm/dev/dynamodb/users/table-name \
  --query Parameter.Value --output text)

echo "    user pool: $USER_POOL_ID"
echo "    DDB table: $USERS_TABLE"

# ---------- collect inputs ----------

SEED_EMAIL="${SEED_EMAIL:-}"
SEED_PASSWORD="${SEED_PASSWORD:-}"
SEED_FIRST_NAME="${SEED_FIRST_NAME:-Admin}"
SEED_LAST_NAME="${SEED_LAST_NAME:-User}"
SEED_ROLE_ID="${SEED_ROLE_ID:-admin}"
SEED_DEPARTMENT="${SEED_DEPARTMENT:-management}"

if [[ -z "$SEED_EMAIL" ]]; then
  read -r -p "Email: " SEED_EMAIL
fi

if [[ -z "$SEED_PASSWORD" ]]; then
  read -r -s -p "Password (min 8 chars, mixed case, with a digit): " SEED_PASSWORD
  echo ""
fi

if [[ -z "$SEED_EMAIL" || -z "$SEED_PASSWORD" ]]; then
  echo "ERROR: email and password are required." >&2
  exit 1
fi

# ---------- 1. Cognito user (idempotent) ----------

if aws cognito-idp admin-get-user \
     --user-pool-id "$USER_POOL_ID" \
     --username "$SEED_EMAIL" \
     >/dev/null 2>&1; then
  echo ">>> Cognito user already exists - skipping create"
else
  echo ">>> Creating Cognito user $SEED_EMAIL"
  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$SEED_EMAIL" \
    --message-action SUPPRESS \
    --user-attributes \
      "Name=email,Value=$SEED_EMAIL" \
      "Name=email_verified,Value=true" \
      "Name=custom:role,Value=$SEED_ROLE_ID" \
      "Name=custom:department,Value=$SEED_DEPARTMENT" \
      "Name=custom:role_id,Value=$SEED_ROLE_ID" \
    >/dev/null
fi

# Fetch (or re-fetch) the sub (Cognito's stable user identifier)
COGNITO_SUB=$(aws cognito-idp admin-get-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$SEED_EMAIL" \
  --query 'UserAttributes[?Name==`sub`].Value' \
  --output text)

if [[ -z "$COGNITO_SUB" ]]; then
  echo "ERROR: failed to read Cognito sub for $SEED_EMAIL" >&2
  exit 1
fi

# Write the user_id custom attribute back so it equals the DDB id (set below)
# This lets the service map JWT -> DDB row consistently.
aws cognito-idp admin-update-user-attributes \
  --user-pool-id "$USER_POOL_ID" \
  --username "$SEED_EMAIL" \
  --user-attributes "Name=custom:user_id,Value=$COGNITO_SUB" \
  >/dev/null

# Always (re)set the password as permanent so the user can log in immediately
echo ">>> Setting permanent password"
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$SEED_EMAIL" \
  --password "$SEED_PASSWORD" \
  --permanent \
  >/dev/null

echo "    Cognito sub: $COGNITO_SUB"

# ---------- 2. DDB row (idempotent) ----------

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Check if row already exists; if so leave it alone.
if EXISTING=$(aws dynamodb get-item \
      --table-name "$USERS_TABLE" \
      --key "{\"PK\":{\"S\":\"USER#${COGNITO_SUB}\"},\"SK\":{\"S\":\"METADATA\"}}" \
      --query 'Item.id.S' --output text 2>/dev/null) && [[ -n "$EXISTING" && "$EXISTING" != "None" ]]; then
  echo ">>> DDB row for user $COGNITO_SUB already exists - skipping insert"
else
  echo ">>> Inserting DDB row in $USERS_TABLE"
  aws dynamodb put-item \
    --table-name "$USERS_TABLE" \
    --condition-expression "attribute_not_exists(PK)" \
    --item "$(jq -n \
      --arg id           "$COGNITO_SUB" \
      --arg sub          "$COGNITO_SUB" \
      --arg email        "$SEED_EMAIL" \
      --arg firstName    "$SEED_FIRST_NAME" \
      --arg lastName     "$SEED_LAST_NAME" \
      --arg roleId       "$SEED_ROLE_ID" \
      --arg department   "$SEED_DEPARTMENT" \
      --arg status       "ACTIVE" \
      --arg now          "$NOW" \
      '{
        PK:         { S: ("USER#" + $id) },
        SK:         { S: "METADATA" },
        GSI1PK:     { S: ("ROLE_USER#" + $roleId) },
        GSI1SK:     { S: ("USER#" + $id) },
        GSI2PK:     { S: ("DEPT#" + $department) },
        GSI2SK:     { S: ("USER#" + $id) },
        id:         { S: $id },
        cognitoSub: { S: $sub },
        email:      { S: $email },
        firstName:  { S: $firstName },
        lastName:   { S: $lastName },
        roleId:     { S: $roleId },
        department: { S: $department },
        status:     { S: $status },
        createdAt:  { S: $now },
        updatedAt:  { S: $now }
      }')"
fi

# ---------- summary ----------

cat <<EOF

Seed complete.

  email      : $SEED_EMAIL
  cognitoSub : $COGNITO_SUB
  roleId     : $SEED_ROLE_ID
  department : $SEED_DEPARTMENT

Try logging in (replace <COGNITO_CLIENT_ID> with the api client id):

  COGNITO_CLIENT_ID=\$(aws ssm get-parameter \\
    --name /bitcrm/dev/cognito/client-id --query Parameter.Value --output text)

  aws cognito-idp initiate-auth \\
    --client-id "\$COGNITO_CLIENT_ID" \\
    --auth-flow USER_PASSWORD_AUTH \\
    --auth-parameters "USERNAME=$SEED_EMAIL,PASSWORD=<your-password>"

The IdToken from that response goes in:
  Authorization: Bearer <IdToken>
when calling https://api.bitcrm.tech-slk.com.
EOF

resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.environment}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  schema {
    name                = "role"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 50
    }
  }

  schema {
    name                = "department"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 0
      max_length = 100
    }
  }

  schema {
    name                = "user_id"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  schema {
    name                = "role_id"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_cognito_user_pool_client" "api" {
  name         = "${var.project}-api"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  access_token_validity  = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    refresh_token = "days"
  }

  read_attributes  = ["email", "custom:department", "custom:user_id", "custom:role_id"]
  write_attributes = ["email", "custom:department", "custom:user_id", "custom:role_id"]
}


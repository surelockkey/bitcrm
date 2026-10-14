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

  # The invitation a new user gets (user-service: AdminCreateUser with
  # DesiredDeliveryMediums EMAIL, and "Resend invite"). Without this block
  # Cognito sends its one-liner "Your username is … and temporary password
  # is …" — no link, no steps. {username} and {####} are Cognito's own
  # placeholders and must stay; the rest is ours (invite-email.html).
  admin_create_user_config {
    allow_admin_create_user_only = false
    invite_message_template {
      email_subject = "${var.app_name}: your account is ready"
      email_message = templatefile("${path.module}/invite-email.html", {
        app_name     = var.app_name
        app_url      = var.app_url
        sign_in_url  = "${var.app_url}/login"
        support_line = var.invite_support_line
      })
      sms_message = "${var.app_name}: your username is {username} and temporary password is {####}. Sign in at ${var.app_url}/login"
    }
  }

  # Cognito's own sender caps at about 50 emails a day and comes from
  # no-reply@verificationemail.com; point it at our SES identity once that
  # one is verified and out of the sandbox (dev's messaging identity, email.tf).
  dynamic "email_configuration" {
    for_each = var.ses_source_arn == null ? [] : [var.ses_source_arn]
    content {
      email_sending_account = "DEVELOPER"
      source_arn            = email_configuration.value
      from_email_address    = var.from_email_address
    }
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


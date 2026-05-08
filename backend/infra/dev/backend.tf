terraform {
  backend "s3" {
    bucket         = "bitcrm-tfstate-066206850539"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "bitcrm-tfstate-lock"
    encrypt        = true
  }
}

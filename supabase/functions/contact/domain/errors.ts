export interface ValidationFieldError {
  field: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  readonly details: ValidationFieldError[];

  constructor(
    details: ValidationFieldError[],
    message = "Request validation failed.",
  ) {
    super("VALIDATION_ERROR", message);
    this.details = details;
  }
}

export class RepositoryError extends DomainError {
  constructor(message: string, options?: ErrorOptions) {
    super("REPOSITORY_ERROR", message, options);
  }
}

export class EmailDeliveryError extends DomainError {
  readonly provider: string;
  readonly submissionId?: string;

  constructor(
    provider: string,
    message: string,
    submissionId?: string,
    options?: ErrorOptions,
  ) {
    super("DELIVERY_FAILED", message, options);
    this.provider = provider;
    this.submissionId = submissionId;
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string, options?: ErrorOptions) {
    super("CONFIGURATION_ERROR", message, options);
  }
}

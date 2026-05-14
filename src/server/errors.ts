// Custom error types used throughout the server

export class BusyError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = 'BusyError';
    this.statusCode = 503;
  }
}

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

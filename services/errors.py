"""Shared service error; routes turn it into a suitable response (JSON or HTML)."""


class ServiceError(Exception):
    """An error whose message can be shown to the user (Persian)."""

    def __init__(self, message: str, status: int = 400, details=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.details = details or []

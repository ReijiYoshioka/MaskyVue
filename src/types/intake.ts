export const MAX_UPLOAD_FILE_COUNT = 10;
export const MAX_UPLOAD_FILE_SIZE_MB = 25;
export const MAX_UPLOAD_TOTAL_SIZE_MB = 100;

export const SUPPORTED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
]);

export interface IntakeFileResult {
  fileId: string;
  fileName: string;
  status: "ACCEPTED" | "REJECTED" | "NO_IMAGE";
  imageCount: number;
  message: string;
}

export interface IntakeResponse {
  jobId: string;
  acceptedFileCount: number;
  rejectedFileCount: number;
  files: IntakeFileResult[];
}

export interface IntakeStatusResponse {
  jobId: string;
  jobStatus: "ACCEPTING" | "READY_FOR_DETECTION" | "FAILED";
  totalFileCount: number;
  totalImageCount: number;
}

export interface ApiErrorResponse {
  errorCode: string;
  message: string;
  details?: string[];
  requestId?: string;
  timestamp: string;
}

export interface SelectedFilePreview {
  id: string;
  file: File;
  fileName: string;
  extension: string;
  sizeBytes: number;
  sizeLabel: string;
  validationState: "sendable" | "blocked";
  validationMessage: string;
  willUpload: boolean;
}

export interface IntakePreUploadSummary {
  selectedCount: number;
  sendableCount: number;
  blockedCount: number;
  selectedCountLabel: string;
  totalSizeLabel: string;
  totalSizeLimitLabel: string;
  requestTone: "info" | "success" | "warning" | "error";
  requestTitle: string;
  requestMessage: string;
  canSubmitRequest: boolean;
}

export interface IntakeResultDisplaySummary {
  hasResults: boolean;
  tone: "info" | "success" | "warning" | "error";
  phaseLabel: string;
  title: string;
  message: string;
  acceptedCount: number;
  rejectedCount: number;
  noImageCount: number;
  reviewHint: string;
}

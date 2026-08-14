export const UPLOAD_CAPABILITY_STORAGE_KEY = "project-builder-upload-capability";

export const ACCEPTED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

const UPLOAD_CAPABILITY_PATTERN = /^pb_upload_[A-Za-z0-9_-]{43}$/;
const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const VIDEO_LIMIT_BYTES = 50 * 1024 * 1024;

export function consumeUploadCapability({ location, history, storage }) {
  const fragment = location.hash.slice(1);
  if (location.hash) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }

  if (UPLOAD_CAPABILITY_PATTERN.test(fragment)) {
    storage.setItem(UPLOAD_CAPABILITY_STORAGE_KEY, fragment);
    return fragment;
  }

  const stored = storage.getItem(UPLOAD_CAPABILITY_STORAGE_KEY);
  if (stored && UPLOAD_CAPABILITY_PATTERN.test(stored)) return stored;
  storage.removeItem(UPLOAD_CAPABILITY_STORAGE_KEY);
  return null;
}

function attachmentError(file) {
  if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
    return "This file type is not supported.";
  }
  if (file.size < 1) return "This file is empty.";
  if (file.name.length > 255 || /[\u0000-\u001f/\\]/.test(file.name)) {
    return "This file name is not supported.";
  }
  const limit = file.type.startsWith("image/") ? IMAGE_LIMIT_BYTES : VIDEO_LIMIT_BYTES;
  if (file.size > limit) {
    return file.type.startsWith("image/")
      ? "Images must be 10 MiB or smaller."
      : "Videos must be 50 MiB or smaller.";
  }
  return null;
}

export function validateAttachmentFiles(files) {
  const selected = Array.from(files);
  if (selected.length > 5) {
    return {
      selectionError: "Choose up to 5 files at a time.",
      entries: selected.map((file, index) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        file,
        status: "error",
        message: "Only 5 attachments are allowed.",
      })),
    };
  }

  return {
    selectionError: "",
    entries: selected.map((file, index) => {
      const message = attachmentError(file);
      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        file,
        status: message ? "error" : "ready",
        message: message ?? "Ready to upload",
      };
    }),
  };
}

async function invokeUploadApi(client, capability, body) {
  const { data, error } = await client.functions.invoke("attachment-upload-api", {
    method: "POST",
    headers: { Authorization: `Bearer ${capability}` },
    body,
  });
  if (error || !data) throw new Error("Attachment service is unavailable.");
  return data;
}

export async function uploadAttachmentFile(client, capability, file, onStage) {
  onStage("preparing");
  const prepared = await invokeUploadApi(client, capability, {
    action: "prepare",
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (
    typeof prepared.attachmentId !== "string" ||
    typeof prepared.bucket !== "string" ||
    typeof prepared.path !== "string" ||
    typeof prepared.token !== "string"
  ) {
    throw new Error("Attachment service returned an invalid upload.");
  }

  onStage("uploading");
  const { error: uploadError } = await client.storage
    .from(prepared.bucket)
    .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
  if (uploadError) throw new Error("File upload failed.");

  onStage("finalizing");
  const completed = await invokeUploadApi(client, capability, {
    action: "complete",
    attachmentId: prepared.attachmentId,
  });
  if (completed.status !== "ready" || typeof completed.reportId !== "string") {
    throw new Error("Attachment could not be finalized.");
  }
  onStage("complete");
  return completed.reportId;
}

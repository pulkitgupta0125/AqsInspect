export function buildFileTree(files = []) {
  const root = [];

  if (!Array.isArray(files)) return root;

  files.forEach((file) => {
    const fullPath = file?.filename;
    if (!fullPath) return;

    const parts = fullPath.split("/").filter(Boolean);
    if (parts.length === 0) return;

    let currentLevel = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      let existing = currentLevel.find((node) => node.name === part);

      if (!existing) {
        existing = {
          name: part,
          type: isFile ? "file" : "folder",
          children: [],
          ...(isFile && { fileData: file }),
        };
        currentLevel.push(existing);
      }

      if (!isFile && !existing.children) {
        existing.children = [];
      }

      if (!isFile) {
        currentLevel = existing.children;
      } else if (isFile) {
        existing.fileData = file;
      }
    });
  });

  return root;
}

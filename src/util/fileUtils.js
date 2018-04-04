var File = Java.type('java.io.File');
var Files = Java.type('java.nio.file.Files');
var FileOutputStream = Java.type('java.io.FileOutputStream');
var FileInputStream = Java.type('java.io.FileInputStream');
var Charsets = Java.type('java.nio.charset.Charset');
var StandardCharsets = Java.type('java.nio.charset.StandardCharsets');
var JString = Java.type('java.lang.String');

var ONE_KB = 1024;
var ONE_MB = ONE_KB * ONE_KB;
var FILE_COPY_BUFFER_SIZE = ONE_MB * 30;

function cleanDirectory (directory) {
  if (typeof directory === 'string') {
    directory = new File(directory);
  }

  var files = verifiedListFiles(directory);

  files.forEach(function (file) {
    forceDelete(file);
  });
}

function verifiedListFiles (directory) {
  if (!directory.exists()) {
    throw new Error(directory + ' does not exist');
  }

  if (!directory.isDirectory()) {
    throw new Error(directory + ' does not exist');
  }

  var files = directory.listFiles();

  if (files == null) { // null if security restricted
    throw new Error('Failed to list contents of ' + directory);
  }

  return Java.from(files);
}

function forceDelete (file) {
  if (file.isDirectory()) {
    deleteDirectory(file);
  } else {
    let filePresent = file.exists();

    if (!file.delete()) {
      if (!filePresent) {
        throw new Error('File does not exist: ' + file);
      }

      throw new Error('Unable to delete file: ' + file);
    }
  }
}

function deleteDirectory (directory) {
  if (typeof directory === 'string') {
    directory = new File(directory);
  }

  if (!directory.exists()) {
    return;
  }

  if (!isSymlink(directory)) {
    cleanDirectory(directory);
  }

  if (!directory.delete()) {
    throw new Error('Unable to delete directory ' + directory + '.');
  }
}

function isSymlink (file) {
  if (file == null) {
    throw new Error('File must not be null');
  }

  return Files.isSymbolicLink(file.toPath());
}

function deleteQuietly (file) {
  if (file == null) {
    return false;
  }

  if (typeof file === 'string') {
    file = new File(file);
  }

  try {
    if (file.isDirectory()) {
      cleanDirectory(file);
    }
  } catch (e) {
  }

  try {
    return file.delete();
  } catch (e) {
    return false;
  }
}

function write (file, str, encoding) {
  if (typeof file === 'string') {
    file = new File(file);
  }

  if (str != null) {
    let out = null;

    try {
      out = openOutputStream(file, false);

      let bytes = new JString(str).getBytes();

      out.write(new JString(bytes, Charsets.forName(encoding || 'UTF-8')).getBytes());
      out.flush();
    } finally {
      close(out);
    }
  }
}

function openOutputStream (file, append) {
  if (file.exists()) {
    if (file.isDirectory()) {
      throw new Error("File '" + file + "' exists but is a directory");
    }
    if (file.canWrite() === false) {
      throw new Error("File '" + file + "' cannot be written to");
    }
  } else {
    var parent = file.getParentFile();

    if (parent != null) {
      if (!parent.mkdirs() && !parent.isDirectory()) {
        throw new Error("Directory '" + parent + "' could not be created");
      }
    }
  }

  return new FileOutputStream(file, append);
}

function copyFile (srcFile, destFile, preserveFileDate) {
  checkFileRequirements(srcFile, destFile);

  if (srcFile.isDirectory()) {
    throw new Error("Source '" + srcFile + "' exists but is a directory");
  }

  if (srcFile.getCanonicalPath().equals(destFile.getCanonicalPath())) {
    throw new Error("Source '" + srcFile + "' and destination '" + destFile + "' are the same");
  }

  let parentFile = destFile.getParentFile();

  if (parentFile != null) {
    if (!parentFile.mkdirs() && !parentFile.isDirectory()) {
      throw new Error("Destination '" + parentFile + "' directory cannot be created");
    }
  }
  if (destFile.exists() && destFile.canWrite() === false) {
    throw new Error("Destination '" + destFile + "' exists but is read-only");
  }

  doCopyFile(srcFile, destFile, preserveFileDate);
}

function doCopyFile (srcFile, destFile, preserveFileDate) {
  if (destFile.exists() && destFile.isDirectory()) {
    throw new Error("Destination '" + destFile + "' exists but is a directory");
  }

  let fis;
  let input;
  let fos;
  let output;

  try {
    fis = new FileInputStream(srcFile);
    input = fis.getChannel();
    fos = new FileOutputStream(destFile);
    output = fos.getChannel()

    let size = input.size(); // TODO See IO-386
    let pos = 0;
    let count = 0;
    while (pos < size) {
      let remain = size - pos;
      count = remain > FILE_COPY_BUFFER_SIZE ? FILE_COPY_BUFFER_SIZE : remain;

      let bytesCopied = output.transferFrom(input, pos, count);

      if (bytesCopied === 0) { // IO-385 - can happen if file is truncated after caching the size
        break; // ensure we don't loop forever
      }

      pos += bytesCopied;
    }
  } finally {
    close(fis);
    close(fos);
  }

  let srcLen = Number(srcFile.length()); // TODO See IO-386
  let dstLen = Number(destFile.length()); // TODO See IO-386

  if (srcLen !== dstLen) {
    throw new Error("Failed to copy full contents from '" +
            srcFile + "' to '" + destFile + "' Expected length: " + srcLen + ' Actual: ' + dstLen);
  }

  if (preserveFileDate) {
    destFile.setLastModified(srcFile.lastModified());
  }
}

function checkFileRequirements (src, dest) {
  if (src == null) {
    throw new Error('Source must not be null');
  }
  if (dest == null) {
    throw new Error('Destination must not be null');
  }
  if (!src.exists()) {
    throw new Error("Source '" + src + "' does not exist");
  }
}

function copyURLToFile (url, destination) {
  if (!destination.exists() && !destination.mkdirs()) {
    throw new Error("Destination '" + destination + "' directory cannot be created");
  }

  if (destination.canWrite() === false) {
    throw new Error("Destination '" + destination + "' cannot be written to");
  }

  let is;

  try {
    is = url.openStream()
    Files.copy(is, destination.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
  } finally {
    close(is);
  }
}

function copyDirectory (srcDir, destDir) {
  checkFileRequirements(srcDir, destDir);

  if (!srcDir.isDirectory()) {
    throw new Error("Source '" + srcDir + "' exists but is not a directory");
  }

  if (srcDir.getCanonicalPath().equals(destDir.getCanonicalPath())) {
    throw new Error("Source '" + srcDir + "' and destination '" + destDir + "' are the same");
  }

  doCopyDirectory(srcDir, destDir);
}

function doCopyDirectory (srcDir, destDir) {
  // recurse
  let srcFiles = srcDir.listFiles();

  if (srcFiles == null) { // null if abstract pathname does not denote a directory, or if an I/O error occurs
    throw new Error('Failed to list contents of ' + srcDir);
  }

  if (destDir.exists()) {
    if (destDir.isDirectory() === false) {
      throw new Error("Destination '" + destDir + "' exists but is not a directory");
    }
  } else {
    if (!destDir.mkdirs() && !destDir.isDirectory()) {
      throw new Error("Destination '" + destDir + "' directory cannot be created");
    }
  }
  if (destDir.canWrite() === false) {
    throw new Error("Destination '" + destDir + "' cannot be written to");
  }

  Java.from(srcFiles).forEach(function (srcFile) {
    var dstFile = new File(destDir, srcFile.getName());

    if (srcFile.isDirectory()) {
      doCopyDirectory(srcFile, dstFile);
    } else {
      doCopyFile(srcFile, dstFile);
    }
  });
}

function close (closeable) {
  if (closeable) {
    try {
      closeable.close();
    } catch (e) {
    }
  }
}

exports = {
  cleanDirectory: cleanDirectory,
  deleteQuietly: deleteQuietly,
  deleteDirectory: deleteDirectory,
  write: write,
  copyFile: copyFile,
  copyURLToFile: copyURLToFile,
  copyDirectory: copyDirectory
};
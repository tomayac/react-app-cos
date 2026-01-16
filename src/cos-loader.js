(async function () {
  await new Promise(resolve => setTimeout(resolve, 100));

  const isCOSAvailable = 'crossOriginStorage' in navigator;
  console.log('COS Loader: isCOSAvailable =', isCOSAvailable);

  // Manifest is injected by the Vite plugin
  // @ts-ignore
  const manifest = __COS_MANIFEST__;

  const vendorEntry = manifest ? manifest['vendor-react'] : null;
  const mainEntry = manifest ? manifest['index'] : null;

  if (!vendorEntry || !mainEntry) {
    console.warn('COS Loader: Missing entries in manifest.');
    return;
  }

  async function getBlobFromCOS(hash) {
    if (!isCOSAvailable) return null;
    try {
      const handles = await navigator.crossOriginStorage.requestFileHandles([
        { algorithm: 'SHA-256', value: hash },
      ]);
      if (handles && handles.length > 0) {
        return await handles[0].getFile();
      }
    } catch (err) {
      if (err.name !== 'NotFoundError') console.error('COS Loader: Error checking COS', err);
    }
    return null;
  }

  async function storeBlobInCOS(blob, hash) {
    if (!isCOSAvailable) return;
    try {
      const handles = await navigator.crossOriginStorage.requestFileHandles(
        [{ algorithm: 'SHA-256', value: hash }],
        { create: true }
      );
      if (handles && handles.length > 0) {
        const writable = await handles[0].createWritable();
        await writable.write(blob);
        await writable.close();
        console.log('COS Loader: Stored bundle in COS', hash);
      }
    } catch (err) {
      console.error('COS Loader: Failed to store in COS', err);
    }
  }

  // Load Vendor Logic
  let vendorUrl = null;

  if (isCOSAvailable && vendorEntry.hash) {
    const cosBlob = await getBlobFromCOS(vendorEntry.hash);
    if (cosBlob) {
      console.log('COS Loader: Loaded vendor from COS!');
      // Enforce MIME type
      const jsBlob = new Blob([cosBlob], { type: 'application/javascript' });
      vendorUrl = URL.createObjectURL(jsBlob);
    } else {
      console.log('COS Loader: Vendor not in COS, fetching from network...');
      try {
        const response = await fetch(vendorEntry.file);
        const blob = await response.blob();
        // Enforce MIME type
        const jsBlob = new Blob([blob], { type: 'application/javascript' });
        vendorUrl = URL.createObjectURL(jsBlob);
        // Fire and forget storage
        storeBlobInCOS(blob, vendorEntry.hash);
      } catch (e) {
        console.error('COS Loader: Network fetch failed for vendor', e);
      }
    }
  }

  // Pass URL to the main entry via global variable
  if (vendorUrl && vendorEntry.globalVar) {
    window[vendorEntry.globalVar] = vendorUrl;
  }

  // Load Main Entry
  try {
    await import(mainEntry.file);
    console.log('COS Loader: App started');
  } catch (err) {
    console.error('COS Loader: Failed to start app', err);
  }
})();

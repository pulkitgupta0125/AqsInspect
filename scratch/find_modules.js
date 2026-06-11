try {
  console.log("officeparser resolved to:", require.resolve('officeparser'));
} catch (e) {
  console.log("officeparser not found");
}

try {
  console.log("electron resolved to:", require.resolve('electron'));
} catch (e) {
  console.log("electron not found");
}

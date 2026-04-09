const Service = require('node-windows').Service;

// Create a new service object
const svc = new Service({
  name: 'ContaEsteService',
  script: require('path').join(__dirname, 'server.js')
});

// Listen for the "uninstall" event, which indicates the
// process is available as a service.
svc.on('uninstall', function () {
  console.log('Uninstall complete.');
  console.log('The service exists: ', svc.exists);
});

// Uninstall the service.
svc.uninstall();

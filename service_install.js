const Service = require('node-windows').Service;

// Create a new service object
const svc = new Service({
  name: 'ContaEsteService',
  description: 'Servidor de Contabilidad ContaEste - Inicio automtico',
  script: require('path').join(__dirname, 'server.js'),
  env: [
    {
      name: "NODE_ENV",
      value: "production"
    }
  ]
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
  console.log('Instalacin completa.');
  svc.start();
});

// Listen for the "alreadyinstalled" event
svc.on('alreadyinstalled', function () {
  console.log('El servicio ya est instalado.');
});

// Listen for the "start" event
svc.on('start', function() {
  console.log(svc.name + ' iniciado exitosamente.');
});

// Install the service
svc.install();

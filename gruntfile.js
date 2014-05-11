module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        jshint: {
            all: ['gruntfile.js', 'proxyPort.js']
        },
        jslint: { // configure the task
            all: {
                src: [ // some example files
                  'proxyPort.js'
                ],
                directives: { // example directives
                    browser: true,
                    predef: []
                },
                options: {
                    edition: 'latest', // specify an edition of jslint or use 'dir/mycustom-jslint.js' for own path
                }
            }
        },
        qunit: {
            all: {
                options: {
                    timeout: 10000,
                    console: false,
                    urls: [
                      'http://localhost:8070/test/browser-winjs/',
                      'http://localhost:8070/test/browser-q/'
                    ]
                }
            }
        },
        connect: {
            server: {
                options: {
                    port: 8070,
                    base: '.'
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-jslint');
    grunt.loadNpmTasks('grunt-contrib-qunit');
    grunt.loadNpmTasks('grunt-contrib-connect');

    grunt.registerTask('default', ['jshint', 'jslint']);
    grunt.registerTask('test', ['connect', 'qunit']);
};
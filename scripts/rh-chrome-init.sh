 #!/bin/bash
 meteor build bundle --directory $BUILD_OPTIONS

 cp -R $PATH_TO_CHROME bundle/bundle/programs/web.chrome
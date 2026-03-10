/* fprintf — write to both stdout and stderr */
#include <stdio.h>

int main(void) {
    fprintf(stdout, "This goes to stdout\n");
    fprintf(stderr, "This goes to stderr\n");
    fprintf(stdout, "Back to stdout\n");
    return 0;
}

/* snprintf — string formatting without I/O, then print result */
#include <stdio.h>
#include <string.h>

int main(void) {
    char buf[256];

    /* Basic snprintf */
    int n = snprintf(buf, sizeof(buf), "Pi is approximately %.5f", 3.14159265);
    printf("%s (wrote %d chars)\n", buf, n);

    /* Truncation */
    char tiny[10];
    n = snprintf(tiny, sizeof(tiny), "Hello, World!");
    printf("Truncated: \"%s\" (would need %d chars)\n", tiny, n);

    /* sscanf */
    int x, y;
    sscanf("42 99", "%d %d", &x, &y);
    printf("sscanf parsed: x=%d y=%d\n", x, y);

    /* sprintf with various types */
    sprintf(buf, "int=%d str=%s hex=%#x char=%c", 7, "test", 0xAB, '!');
    printf("%s\n", buf);

    return 0;
}

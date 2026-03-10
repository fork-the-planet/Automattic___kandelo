/* math — exercise printf number formatting and basic math */
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    /* Integer formatting */
    printf("Decimal:     %d\n", 42);
    printf("Hex:         0x%x\n", 255);
    printf("Octal:       0%o\n", 255);
    printf("Negative:    %d\n", -123);
    printf("Unsigned:    %u\n", 4294967295u);
    printf("Padded:      [%10d]\n", 42);
    printf("Left-align:  [%-10d]\n", 42);
    printf("Zero-pad:    [%010d]\n", 42);

    /* Float formatting */
    printf("Float:       %f\n", 3.14159);
    printf("Scientific:  %e\n", 0.000123);
    printf("Compact:     %g\n", 100.0);

    /* atoi/strtol */
    printf("atoi(\"99\"): %d\n", atoi("99"));
    printf("strtol(\"ff\", 16): %ld\n", strtol("ff", NULL, 16));

    return 0;
}

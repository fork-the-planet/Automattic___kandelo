/* strings — exercise string.h functions via printf formatting */
#include <stdio.h>
#include <string.h>
#include <ctype.h>

int main(void) {
    const char *greeting = "Hello, World!";
    char buf[64];

    printf("Original: %s\n", greeting);
    printf("Length:   %zu\n", strlen(greeting));

    strcpy(buf, greeting);
    printf("Copy:     %s\n", buf);

    strcat(buf, " How are you?");
    printf("Concat:   %s\n", buf);

    printf("Find 'W': %s\n", strchr(greeting, 'W'));
    printf("Compare:  %d\n", strcmp("abc", "abd"));

    /* toupper loop */
    printf("Upper:    ");
    for (const char *p = greeting; *p; p++)
        putchar(toupper((unsigned char)*p));
    putchar('\n');

    return 0;
}

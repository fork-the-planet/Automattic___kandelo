/* malloc — dynamic memory allocation via brk/mmap */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    /* Small allocation (typically uses brk) */
    char *s = malloc(64);
    if (!s) {
        fprintf(stderr, "malloc failed\n");
        return 1;
    }
    strcpy(s, "allocated on the heap!");
    printf("Small: %s\n", s);
    free(s);

    /* Larger allocation */
    int *arr = malloc(1000 * sizeof(int));
    if (!arr) {
        fprintf(stderr, "malloc failed\n");
        return 1;
    }
    for (int i = 0; i < 1000; i++)
        arr[i] = i * i;
    printf("arr[0]=%d arr[10]=%d arr[999]=%d\n", arr[0], arr[10], arr[999]);
    free(arr);

    /* calloc (zero-initialized) */
    int *zeros = calloc(10, sizeof(int));
    if (!zeros) {
        fprintf(stderr, "calloc failed\n");
        return 1;
    }
    int all_zero = 1;
    for (int i = 0; i < 10; i++)
        if (zeros[i] != 0) all_zero = 0;
    printf("calloc zeroed: %s\n", all_zero ? "yes" : "no");
    free(zeros);

    /* realloc */
    char *buf = malloc(16);
    strcpy(buf, "short");
    buf = realloc(buf, 128);
    strcat(buf, " then extended");
    printf("realloc: %s\n", buf);
    free(buf);

    printf("All allocations succeeded.\n");
    return 0;
}

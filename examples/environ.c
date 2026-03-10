/* environ — process info and environment */
#include <stdio.h>
#include <unistd.h>

int main(void) {
    printf("PID:  %d\n", getpid());
    printf("PPID: %d\n", getppid());
    printf("UID:  %d\n", getuid());
    printf("GID:  %d\n", getgid());

    char cwd[256];
    if (getcwd(cwd, sizeof(cwd)))
        printf("CWD:  %s\n", cwd);

    return 0;
}

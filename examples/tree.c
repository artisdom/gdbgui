#include <stdlib.h>
#include <stdio.h>
#include <string.h>

struct Node
{
    struct Node* left;
    struct Node* right;
    char* name;
};

void visit(struct Node* node)
{
    printf("visiting node '%s'\n", node->name);
}

void dfs(struct Node *node)
{
    if (node == NULL)
    {
        return;
    }

    visit(node);
    dfs(node->left);
    dfs(node->right);
}

int main(void)
{
    /* initialize nodes so that left/right are NULL and each
    node has a name */
    struct Node
        root = {.name = "root"},
        a = {.name = "a"},
        b = {.name = "b"},
        c = {.name = "c"},
        d = {.name = "d"},
        e = {.name = "e"},
        f = {.name = "f"};

    /* connect nodes */
    root.left = &a;
    root.right = &b;
    a.left = &c;
    a.right = &d;
    d.left = &e;
    b.right = &f;

    printf("beginning depth first search\n");
    dfs(&root);
    printf("finished depth first search\n");
    return 0;
}

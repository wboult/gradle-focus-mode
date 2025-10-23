package com.example;

public class Project002 {
    public static void main(String[] args) {
        System.out.println("Hello from project-002");
        new Project001().doSomething();
    }

    public void doSomething() {
        System.out.println("project-002 doing something");
    }
}
